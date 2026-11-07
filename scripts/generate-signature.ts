import { createHmac } from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const secret = process.env.KYC_WEBHOOK_SECRET || 'local-dev-kyc-secret';

export function generateWebhookSignature(
  payload: Record<string, unknown> | string,
  customSecret?: string,
): string {
  const bodyString =
    typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHmac('sha256', customSecret || secret)
    .update(bodyString)
    .digest('hex');
}

// Allow running directly: ts-node scripts/generate-signature.ts '<json_payload>'
if (require.main === module) {
  const args = process.argv.slice(2);
  const samplePayload = args[0]
    ? JSON.parse(args[0])
    : {
        event_id: 'evt-uuid-abc123',
        investor_id: 'inv-uuid-456',
        new_status: 'approved',
        timestamp: '2026-06-20T14:30:00Z',
      };

  const signature = generateWebhookSignature(samplePayload);
  console.log('Payload:', JSON.stringify(samplePayload, null, 2));
  console.log('HMAC SHA-256 Signature (X-KYC-Signature):');
  console.log(signature);
}

