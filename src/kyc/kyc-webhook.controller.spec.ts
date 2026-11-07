import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { KycWebhookController } from './kyc-webhook.controller';
import { KycWebhookService } from './kyc-webhook.service';
import { KycStatus } from '../common/interfaces/kyc-status.interface';

describe('KycWebhookController', () => {
  let controller: KycWebhookController;
  let service: {
    tryAcquireEventId: jest.Mock;
    enqueueStatusUpdate: jest.Mock;
  };
  let configService: { get: jest.Mock };

  const secret = 'test-webhook-secret';
  const payload = {
    event_id: 'evt-uuid-abc123',
    investor_id: 'inv-uuid-456',
    new_status: KycStatus.Approved,
    timestamp: '2026-06-20T14:30:00Z',
  };

  const rawBodyBuffer = Buffer.from(JSON.stringify(payload));
  const validSignature = createHmac('sha256', secret)
    .update(rawBodyBuffer)
    .digest('hex');

  beforeEach(() => {
    service = {
      tryAcquireEventId: jest.fn(),
      enqueueStatusUpdate: jest.fn(),
    };
    configService = {
      get: jest.fn().mockReturnValue(secret),
    };

    controller = new KycWebhookController(
      service as unknown as KycWebhookService,
      configService as unknown as ConfigService,
    );
  });

  it('rejects invalid signature with 401 UnauthorizedException', async () => {
    await expect(
      controller.handleKycWebhook(
        payload,
        'invalid-signature-hex',
        rawBodyBuffer,
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(service.tryAcquireEventId).not.toHaveBeenCalled();
    expect(service.enqueueStatusUpdate).not.toHaveBeenCalled();
  });

  it('handles duplicate events idempotently returning 200 without re-enqueueing', async () => {
    service.tryAcquireEventId.mockResolvedValue(true); // isDuplicate = true

    const result = await controller.handleKycWebhook(
      payload,
      validSignature,
      rawBodyBuffer,
    );

    expect(result).toEqual({ received: true });
    expect(service.tryAcquireEventId).toHaveBeenCalledWith('evt-uuid-abc123');
    expect(service.enqueueStatusUpdate).not.toHaveBeenCalled();
  });

  it('enqueues status update and returns 200 for new valid webhooks', async () => {
    service.tryAcquireEventId.mockResolvedValue(false); // isDuplicate = false
    service.enqueueStatusUpdate.mockResolvedValue(undefined);

    const result = await controller.handleKycWebhook(
      payload,
      validSignature,
      rawBodyBuffer,
    );

    expect(result).toEqual({ received: true });
    expect(service.tryAcquireEventId).toHaveBeenCalledWith('evt-uuid-abc123');
    expect(service.enqueueStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-uuid-abc123',
        investorId: 'inv-uuid-456',
        newStatus: KycStatus.Approved,
      }),
    );
  });
});

