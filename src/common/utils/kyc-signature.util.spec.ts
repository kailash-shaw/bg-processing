import { createHmac } from 'crypto';
import { verifyKycWebhookSignature } from './kyc-signature.util';

describe('verifyKycWebhookSignature', () => {
  const secret = 'test-webhook-secret';
  const rawBody = JSON.stringify({
    event_id: 'evt-1',
    investor_id: 'inv-1',
    new_status: 'approved',
    timestamp: '2026-06-20T14:30:00Z',
  });

  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');

  it('accepts a valid signature', () => {
    expect(
      verifyKycWebhookSignature(Buffer.from(rawBody), signature, secret),
    ).toBe(true);
  });

  it('accepts a valid signature with sha256= prefix', () => {
    expect(
      verifyKycWebhookSignature(
        Buffer.from(rawBody),
        `sha256=${signature}`,
        secret,
      ),
    ).toBe(true);
  });

  it('rejects a signature signed with a different secret', () => {
    expect(
      verifyKycWebhookSignature(
        Buffer.from(rawBody),
        createHmac('sha256', 'other').update(rawBody).digest('hex'),
        secret,
      ),
    ).toBe(false);
  });

  it('rejects a signature that does not match the raw body', () => {
    const tamperedBody = JSON.stringify({ event_id: 'evt-2' });
    expect(
      verifyKycWebhookSignature(Buffer.from(tamperedBody), signature, secret),
    ).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(
      verifyKycWebhookSignature(Buffer.from(rawBody), undefined, secret),
    ).toBe(false);
  });

  it('rejects an empty secret', () => {
    expect(
      verifyKycWebhookSignature(Buffer.from(rawBody), signature, ''),
    ).toBe(false);
  });
});
