import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seed(): Promise<void> {
  console.log('🌱 Starting database seeding...');

  // Clean existing test data
  await prisma.webhookEvent.deleteMany({});
  await prisma.investor.deleteMany({});
  await prisma.tenant.deleteMany({});

  // 1. Create Tenants
  const tenant1 = await prisma.tenant.create({
    data: {
      id: 'tenant-meridian-1',
      name: 'Meridian Capital',
    },
  });

  const tenant2 = await prisma.tenant.create({
    data: {
      id: 'tenant-global-2',
      name: 'Global Ventures',
    },
  });

  console.log(`✓ Seeded tenants: ${tenant1.id}, ${tenant2.id}`);

  // 2. Create Investors
  const investor1 = await prisma.investor.create({
    data: {
      id: 'inv-uuid-456',
      tenant_id: tenant1.id,
      email: 'investor.meridian@example.com',
      kyc_status: 'pending',
    },
  });

  const investor2 = await prisma.investor.create({
    data: {
      id: 'inv-uuid-789',
      tenant_id: tenant1.id,
      email: 'investor.approved@example.com',
      kyc_status: 'approved',
    },
  });

  const investor3 = await prisma.investor.create({
    data: {
      id: 'inv-uuid-other-tenant',
      tenant_id: tenant2.id,
      email: 'investor.global@example.com',
      kyc_status: 'pending',
    },
  });

  console.log(
    `✓ Seeded investors: ${investor1.id}, ${investor2.id}, ${investor3.id}`,
  );

  console.log('✅ Seeding completed successfully.');
}

seed()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

