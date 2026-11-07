import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT, KYC_QUEUE } from '../infrastructure/redis/redis.module';
import {
  KYC_IDEMPOTENCY_KEY_PREFIX,
  KYC_IDEMPOTENCY_TTL_SECONDS,
  KYC_WEBHOOK_QUEUE_NAME,
} from '../common/constants/kyc.constants';
import { KycWebhookJobData } from '../common/interfaces/webhook.interface';

@Injectable()
export class KycWebhookService {
  private readonly logger = new Logger(KycWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(KYC_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Tries to acquire the idempotency key of a provider event.
   * Returns `true` when the event was already processed before (duplicate).
   */
  async tryAcquireEventId(eventId: string): Promise<boolean> {
    const key = `${KYC_IDEMPOTENCY_KEY_PREFIX}${eventId}`;

    // 1. Fast path: check if currently in-flight in Redis
    const inFlight = await this.redis.get(key);
    if (inFlight !== null) {
      return true;
    }

    // 2. Secondary check: verify if already persisted in PostgreSQL
    // (handles cases where the worker finished and cleared the Redis key)
    const alreadyProcessed = await this.prisma.webhookEvent.findUnique({
      where: { event_id: eventId },
      select: { id: true },
    });

    if (alreadyProcessed) {
      return true;
    }

    // 3. Atomically acquire the lock with NX and TTL
    const acquired = await this.redis.set(
      key,
      'processing',
      'EX',
      KYC_IDEMPOTENCY_TTL_SECONDS,
      'NX',
    );

    return acquired === null;
  }

  async releaseEventId(eventId: string): Promise<void> {
    await this.redis.del(`${KYC_IDEMPOTENCY_KEY_PREFIX}${eventId}`);
  }

  async enqueueStatusUpdate(data: KycWebhookJobData): Promise<void> {
    await this.queue.add(KYC_WEBHOOK_QUEUE_NAME, data, {
      jobId: data.eventId,
      removeOnComplete: true,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });
  }

  async processUpdate(data: KycWebhookJobData): Promise<void> {
    // Prevent duplicate processing if already recorded in DB
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { event_id: data.eventId },
    });

    if (existing) {
      this.logger.warn(
        `Webhook event ${data.eventId} already recorded in DB; skipping re-execution.`,
      );
      await this.releaseEventId(data.eventId);
      return;
    }

    // Execute atomic update in PostgreSQL
    await this.prisma.$transaction(async (tx) => {
      const investor = await tx.investor.findUnique({
        where: { id: data.investorId },
      });

      if (!investor) {
        throw new Error(
          `Investor with id ${data.investorId} does not exist in the database`,
        );
      }

      await tx.investor.update({
        where: { id: data.investorId },
        data: { kyc_status: data.newStatus },
      });

      await tx.webhookEvent.create({
        data: {
          event_id: data.eventId,
          provider: data.provider,
          payload: data.payload,
          investor_id: data.investorId,
          processed_at: new Date(),
        },
      });
    });

    // Clear the Redis idempotency key after successful processing as specified
    await this.releaseEventId(data.eventId);

    this.logger.log(`KYC status update processed for event ${data.eventId}`);
  }
}
