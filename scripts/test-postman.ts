import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as path from 'path';
import newman from 'newman';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function runPostmanTests(): Promise<void> {
  console.log('🚀 Starting NestJS application for Postman Collection test...');

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

  const port = 3000;
  try {
    await app.listen(port);
    console.log(`✓ Application listening on http://localhost:${port}`);
  } catch (err: any) {
    if (err.code === 'EADDRINUSE') {
      console.log(`ℹ Port ${port} is already in use; assuming app is already running.`);
    } else {
      throw err;
    }
  }

  // Ensure DB seed exists
  const prisma = app.get(PrismaService);
  const tenant = await prisma.tenant.findUnique({
    where: { id: 'tenant-meridian-1' },
  });
  if (!tenant) {
    console.log('🌱 Seeding initial tenant & investor records...');
    await prisma.tenant.create({
      data: { id: 'tenant-meridian-1', name: 'Meridian Capital' },
    });
    await prisma.tenant.create({
      data: { id: 'tenant-global-2', name: 'Global Ventures' },
    });
    await prisma.investor.create({
      data: {
        id: 'inv-uuid-456',
        tenant_id: 'tenant-meridian-1',
        email: 'investor.meridian@example.com',
        kyc_status: 'pending',
      },
    });
  }

  const collectionPath = path.resolve(
    __dirname,
    '../docs/postman_collection.json',
  );

  console.log(`\n📬 Executing Postman Collection: ${collectionPath}\n`);

  newman.run(
    {
      collection: require(collectionPath),
      reporters: ['cli'],
      envVar: [
        { key: 'baseUrl', value: `http://localhost:${port}` },
        { key: 'KYC_WEBHOOK_SECRET', value: 'local-dev-kyc-secret' },
      ],
    },
    async (err, summary) => {
      if (err) {
        console.error('❌ Newman execution failed:', err);
        await app.close();
        process.exit(1);
      }

      const failures = summary.run.failures;
      if (failures && failures.length > 0) {
        console.error(`❌ Postman tests failed with ${failures.length} errors.`);
        await app.close();
        process.exit(1);
      } else {
        console.log('\n🎉 ALL POSTMAN COLLECTION TESTS PASSED SUCCESSFULLY!\n');
        await app.close();
        process.exit(0);
      }
    },
  );
}

runPostmanTests().catch((err) => {
  console.error('Fatal error running postman tests:', err);
  process.exit(1);
});

