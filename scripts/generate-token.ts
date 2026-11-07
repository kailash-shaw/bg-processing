import * as jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const secret = process.env.JWT_SECRET || 'local-dev-jwt-secret';

interface GenerateTokenOptions {
  investorId: string;
  tenantId: string;
  email?: string;
  expiresIn?: string;
}

export function generateToken(options: GenerateTokenOptions): string {
  const payload = {
    sub: options.investorId,
    investor_id: options.investorId,
    tenant_id: options.tenantId,
    email: options.email ?? 'investor@example.com',
  };

  return jwt.sign(payload, secret, {
    expiresIn: (options.expiresIn ?? '1h') as any,
  });
}

// Allow running directly: ts-node scripts/generate-token.ts <investor_id> <tenant_id>
if (require.main === module) {
  const args = process.argv.slice(2);
  const investorId = args[0] || 'inv-uuid-456';
  const tenantId = args[1] || 'tenant-meridian-1';

  const token = generateToken({ investorId, tenantId });
  console.log('Generated JWT Token:');
  console.log(token);
}

