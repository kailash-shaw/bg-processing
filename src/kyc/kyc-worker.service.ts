import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import {
  REDIS_CONFIG,
  type KycRedisConfig,
} from '../infrastructure/redis/redis.module';
import { KYC_WEBHOOK_QUEUE_NAME } from '../common/constants/kyc.constants';
import { KycWebhookJobData } from '../common/interfaces/webhook.interface';
import { KycWebhookService } from './kyc-webhook.service';

@Injectable()
export class KycWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(KycWorkerService.name);
  private readonly worker: Worker<KycWebhookJobData>;

  constructor(
    @Inject(REDIS_CONFIG) private readonly redisConfig: KycRedisConfig,
    private readonly kycWebhookService: KycWebhookService,
  ) {
    this.worker = new Worker<KycWebhookJobData>(
      KYC_WEBHOOK_QUEUE_NAME,
      async (job: Job<KycWebhookJobData>) => {
        await this.kycWebhookService.processUpdate(job.data);
      },
      {
        connection: {
          host: this.redisConfig.host,
          port: this.redisConfig.port,
          password: this.redisConfig.password,
          maxRetriesPerRequest: this.redisConfig.maxRetriesPerRequest,
        },
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} failed for event ${job?.data?.eventId}: ${err.message}`,
        err.stack,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
