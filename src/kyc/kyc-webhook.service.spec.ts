import { KycWebhookService } from './kyc-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { KycStatus } from '../common/interfaces/kyc-status.interface';
import { KycWebhookJobData } from '../common/interfaces/webhook.interface';

describe('KycWebhookService', () => {
  let service: KycWebhookService;
  let prisma: {
    investor: { findUnique: jest.Mock; update: jest.Mock };
    webhookEvent: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let queue: {
    add: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      investor: { findUnique: jest.fn(), update: jest.fn() },
      webhookEvent: { findUnique: jest.fn(), create: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (cb) => cb(prisma)),
    };

    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    queue = {
      add: jest.fn(),
    };

    service = new KycWebhookService(
      prisma as unknown as PrismaService,
      redis as any,
      queue as any,
    );
  });

  describe('tryAcquireEventId', () => {
    it('returns true if event is currently in-flight in Redis', async () => {
      redis.get.mockResolvedValue('processing');

      const result = await service.tryAcquireEventId('evt-1');

      expect(result).toBe(true);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('returns true if event was already recorded in DB', async () => {
      redis.get.mockResolvedValue(null);
      prisma.webhookEvent.findUnique.mockResolvedValue({ id: 'evt-rec-1' });

      const result = await service.tryAcquireEventId('evt-1');

      expect(result).toBe(true);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('returns false when successfully acquiring new event lock', async () => {
      redis.get.mockResolvedValue(null);
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      redis.set.mockResolvedValue('OK'); // acquired

      const result = await service.tryAcquireEventId('evt-1');

      expect(result).toBe(false); // not duplicate
      expect(redis.set).toHaveBeenCalledWith(
        'kyc:webhook:evt-1',
        'processing',
        'EX',
        86400,
        'NX',
      );
    });

    it('returns true if concurrent request won the lock race (set NX returns null)', async () => {
      redis.get.mockResolvedValue(null);
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      redis.set.mockResolvedValue(null); // another won race

      const result = await service.tryAcquireEventId('evt-1');

      expect(result).toBe(true); // is duplicate
    });
  });

  describe('enqueueStatusUpdate', () => {
    it('adds job to BullMQ queue with eventId as jobId', async () => {
      const jobData: KycWebhookJobData = {
        eventId: 'evt-1',
        investorId: 'inv-1',
        newStatus: KycStatus.Approved,
        timestamp: '2026-06-20T14:30:00Z',
        provider: 'kyc',
        payload: {
          event_id: 'evt-1',
          investor_id: 'inv-1',
          new_status: KycStatus.Approved,
          timestamp: '2026-06-20T14:30:00Z',
        },
      };

      await service.enqueueStatusUpdate(jobData);

      expect(queue.add).toHaveBeenCalledWith(
        'kyc-status-update',
        jobData,
        expect.objectContaining({ jobId: 'evt-1' }),
      );
    });
  });

  describe('processUpdate', () => {
    const jobData: KycWebhookJobData = {
      eventId: 'evt-1',
      investorId: 'inv-1',
      newStatus: KycStatus.Approved,
      timestamp: '2026-06-20T14:30:00Z',
      provider: 'kyc',
      payload: {
        event_id: 'evt-1',
        investor_id: 'inv-1',
        new_status: KycStatus.Approved,
        timestamp: '2026-06-20T14:30:00Z',
      },
    };

    it('updates investor status, creates WebhookEvent, and releases Redis key', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.investor.findUnique.mockResolvedValue({ id: 'inv-1' });
      prisma.investor.update.mockResolvedValue({
        id: 'inv-1',
        kyc_status: 'approved',
      });
      prisma.webhookEvent.create.mockResolvedValue({ id: 'we-1' });

      await service.processUpdate(jobData);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.investor.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { kyc_status: KycStatus.Approved },
      });
      expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event_id: 'evt-1',
          investor_id: 'inv-1',
        }),
      });
      expect(redis.del).toHaveBeenCalledWith('kyc:webhook:evt-1');
    });

    it('skips re-processing if event is already in DB', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue({ id: 'existing-event' });

      await service.processUpdate(jobData);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith('kyc:webhook:evt-1');
    });

    it('throws if investor does not exist', async () => {
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.investor.findUnique.mockResolvedValue(null);

      await expect(service.processUpdate(jobData)).rejects.toThrow(
        /does not exist in the database/,
      );
    });
  });
});

