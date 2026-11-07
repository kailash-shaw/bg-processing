import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as http from 'http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { generateWebhookSignature } from './generate-signature';
import { generateToken } from './generate-token';

interface HttpResponse {
  status: number;
  data: any;
}

function makeRequest(
  url: string,
  options: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let data = rawData;
          try {
            data = JSON.parse(rawData);
          } catch {
            // keep raw string
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runApiTests(): Promise<void> {
  console.log('🚀 Bootstrapping NestJS application for API testing...');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: ['error', 'warn'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const testPort = 3105;
  await app.listen(testPort);
  const baseUrl = `http://127.0.0.1:${testPort}`;
  console.log(`✓ Test application running on ${baseUrl}\n`);

  const prisma = app.get(PrismaService);

  // Setup seed data for tests
  console.log('📦 Resetting & preparing test records...');
  await prisma.webhookEvent.deleteMany({});
  await prisma.investor.deleteMany({});
  await prisma.tenant.deleteMany({});

  const tenant1 = await prisma.tenant.create({
    data: { id: 'tenant-alpha', name: 'Alpha Capital' },
  });
  const tenant2 = await prisma.tenant.create({
    data: { id: 'tenant-beta', name: 'Beta Capital' },
  });

  const investorAlpha = await prisma.investor.create({
    data: {
      id: 'inv-alpha-1',
      tenant_id: tenant1.id,
      email: 'investor.alpha@example.com',
      kyc_status: 'pending',
    },
  });

  const investorBeta = await prisma.investor.create({
    data: {
      id: 'inv-beta-1',
      tenant_id: tenant2.id,
      email: 'investor.beta@example.com',
      kyc_status: 'pending',
    },
  });
  console.log('✓ Test fixtures ready.\n');

  let passed = 0;
  let failed = 0;

  function assert(
    testName: string,
    condition: boolean,
    details?: string,
  ): void {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} - ${details ?? ''}`);
      failed++;
    }
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  TESTING ENDPOINT 1: POST /webhooks/kyc');
  console.log('═══════════════════════════════════════════════════════════');

  const testEventId = `evt-${Date.now()}`;
  const validPayload = {
    event_id: testEventId,
    investor_id: investorAlpha.id,
    new_status: 'approved',
    timestamp: new Date().toISOString(),
  };
  const validBody = JSON.stringify(validPayload);
  const validSig = generateWebhookSignature(validBody);

  // 1. Missing signature
  const res1 = await makeRequest(`${baseUrl}/webhooks/kyc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: validBody,
  });
  assert('Missing signature returns 401', res1.status === 401, `Got ${res1.status}`);

  // 2. Invalid signature
  const res2 = await makeRequest(`${baseUrl}/webhooks/kyc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KYC-Signature': 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    },
    body: validBody,
  });
  assert('Invalid signature returns 401', res2.status === 401, `Got ${res2.status}`);

  // 3. Invalid payload - missing investor_id
  const invalidPayload1 = {
    event_id: 'evt-no-investor',
    new_status: 'approved',
    timestamp: new Date().toISOString(),
  };
  const invalidBody1 = JSON.stringify(invalidPayload1);
  const invalidSig1 = generateWebhookSignature(invalidBody1);
  const res3 = await makeRequest(`${baseUrl}/webhooks/kyc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KYC-Signature': invalidSig1,
    },
    body: invalidBody1,
  });
  assert('Missing required fields returns 400', res3.status === 400, `Got ${res3.status}`);

  // 4. Invalid payload - invalid enum status
  const invalidPayload2 = {
    event_id: 'evt-bad-status',
    investor_id: investorAlpha.id,
    new_status: 'unknown_status_xyz',
    timestamp: new Date().toISOString(),
  };
  const invalidBody2 = JSON.stringify(invalidPayload2);
  const invalidSig2 = generateWebhookSignature(invalidBody2);
  const res4 = await makeRequest(`${baseUrl}/webhooks/kyc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KYC-Signature': invalidSig2,
    },
    body: invalidBody2,
  });
  assert('Invalid status format returns 400', res4.status === 400, `Got ${res4.status}`);

  // 5. Valid payload and signature -> 200 OK
  const res5 = await makeRequest(`${baseUrl}/webhooks/kyc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KYC-Signature': validSig,
    },
    body: validBody,
  });
  assert(
    'Valid webhook returns 200 OK immediately',
    res5.status === 200 && res5.data?.received === true,
    `Got ${res5.status} with body ${JSON.stringify(res5.data)}`,
  );

  // 6. Duplicate webhook (same event_id) -> 200 OK without re-processing
  const res6 = await makeRequest(`${baseUrl}/webhooks/kyc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KYC-Signature': validSig,
    },
    body: validBody,
  });
  assert(
    'Duplicate webhook returns 200 OK idempotently',
    res6.status === 200 && res6.data?.received === true,
    `Got ${res6.status}`,
  );

  // Wait for async queue worker to process PostgreSQL update
  console.log('\n  ⏳ Waiting 1.5s for async BullMQ queue worker to process update...');
  await new Promise((r) => setTimeout(r, 1500));

  // Verify DB state
  const updatedInvestor = await prisma.investor.findUnique({
    where: { id: investorAlpha.id },
  });
  assert(
    'Worker updated investor status in PostgreSQL to approved',
    updatedInvestor?.kyc_status === 'approved',
    `Current status: ${updatedInvestor?.kyc_status}`,
  );

  const webhookAudit = await prisma.webhookEvent.findUnique({
    where: { event_id: testEventId },
  });
  assert(
    'Worker stored WebhookEvent in PostgreSQL for audit',
    webhookAudit !== null && webhookAudit?.event_id === testEventId,
    `Webhook record found: ${Boolean(webhookAudit)}`,
  );

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  TESTING ENDPOINT 2: GET /investors/:id/kyc-status');
  console.log('═══════════════════════════════════════════════════════════');

  const tokenAlpha = generateToken({
    investorId: investorAlpha.id,
    tenantId: tenant1.id,
  });

  const tokenBeta = generateToken({
    investorId: investorBeta.id,
    tenantId: tenant2.id,
  });

  // 7. Missing Authorization header -> 401
  const res7 = await makeRequest(
    `${baseUrl}/investors/${investorAlpha.id}/kyc-status`,
    { method: 'GET' },
  );
  assert('Missing Bearer token returns 401', res7.status === 401, `Got ${res7.status}`);

  // 8. Invalid Bearer token -> 401
  const res8 = await makeRequest(
    `${baseUrl}/investors/${investorAlpha.id}/kyc-status`,
    {
      method: 'GET',
      headers: { Authorization: 'Bearer this.is.an.invalid.token' },
    },
  );
  assert('Invalid Bearer token returns 401', res8.status === 401, `Got ${res8.status}`);

  // 9. Token missing required tenant_id claim -> 401
  const tokenMissingTenant = generateToken({
    investorId: investorAlpha.id,
    tenantId: '',
  });
  const res9 = await makeRequest(
    `${baseUrl}/investors/${investorAlpha.id}/kyc-status`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenMissingTenant}` },
    },
  );
  assert(
    'Token missing tenant_id claim returns 401',
    res9.status === 401,
    `Got ${res9.status}`,
  );

  // 10. Investor does not exist -> 404
  const res10 = await makeRequest(
    `${baseUrl}/investors/non-existent-uuid-999/kyc-status`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenAlpha}` },
    },
  );
  assert('Non-existent investor returns 404', res10.status === 404, `Got ${res10.status}`);

  // 11. Tenant mismatch (tenant-beta user accessing tenant-alpha investor) -> 403 Forbidden
  const res11 = await makeRequest(
    `${baseUrl}/investors/${investorAlpha.id}/kyc-status`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenBeta}` },
    },
  );
  assert(
    'Tenant mismatch returns 403 Forbidden',
    res11.status === 403,
    `Got ${res11.status}`,
  );

  // 12. Matching tenant & valid investor -> 200 OK with correct shape
  const res12 = await makeRequest(
    `${baseUrl}/investors/${investorAlpha.id}/kyc-status`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenAlpha}` },
    },
  );
  assert(
    'Matching tenant returns 200 OK with investor status & event timestamp',
    res12.status === 200 &&
      res12.data?.investor_id === investorAlpha.id &&
      res12.data?.kyc_status === 'approved' &&
      typeof res12.data?.last_webhook_event_at === 'string',
    `Got ${res12.status}: ${JSON.stringify(res12.data)}`,
  );

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════\n');

  await app.close();

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runApiTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
