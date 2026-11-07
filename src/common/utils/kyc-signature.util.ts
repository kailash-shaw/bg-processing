import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies the HMAC SHA-256 signature of an incoming KYC webhook.
 *
 * The provider signs the raw request body with the `KYC_WEBHOOK_SECRET` and
 * sends the resulting signature in the `X-KYC-Signature` header.
 */
export function verifyKycWebhookSignature(
  rawBody: Buffer | string | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }

  const cleanSignature = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expectedSignature = createHmac('sha256', secret)
    .update(bodyBuffer)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(cleanSignature, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
