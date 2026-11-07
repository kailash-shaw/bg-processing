import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvestorService } from './investor.service';
import { PrismaService } from '../prisma/prisma.service';
import { KycStatus } from '../common/interfaces/kyc-status.interface';
import { JwtPayload } from '../common/interfaces/jwt.interface';

describe('InvestorService', () => {
  let service: InvestorService;
  let prisma: {
    investor: { findUnique: jest.Mock };
    webhookEvent: { findFirst: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      investor: { findUnique: jest.fn() },
      webhookEvent: { findFirst: jest.fn() },
    };

    service = new InvestorService(prisma as unknown as PrismaService);
  });

  const mockJwt: JwtPayload = {
    sub: 'inv-123',
    tenant_id: 'tenant-1',
    investor_id: 'inv-123',
  };

  it('returns investor KYC status with the latest webhook event timestamp', async () => {
    const mockInvestor = {
      id: 'inv-123',
      tenant_id: 'tenant-1',
      email: 'investor@example.com',
      kyc_status: KycStatus.Approved,
    };

    const mockEvent = {
      id: 'evt-rec-1',
      event_id: 'evt-1',
      investor_id: 'inv-123',
      processed_at: new Date('2026-06-20T14:30:00Z'),
    };

    prisma.investor.findUnique.mockResolvedValue(mockInvestor);
    prisma.webhookEvent.findFirst.mockResolvedValue(mockEvent);

    const result = await service.getKycStatus('inv-123', mockJwt);

    expect(result).toEqual({
      id: 'inv-123',
      investor_id: 'inv-123',
      email: 'investor@example.com',
      kyc_status: KycStatus.Approved,
      last_webhook_event_at: '2026-06-20T14:30:00.000Z',
    });
    expect(prisma.investor.findUnique).toHaveBeenCalledWith({
      where: { id: 'inv-123' },
    });
    expect(prisma.webhookEvent.findFirst).toHaveBeenCalledWith({
      where: { investor_id: 'inv-123' },
      orderBy: { processed_at: 'desc' },
    });
  });

  it('returns null for last_webhook_event_at if no event exists', async () => {
    const mockInvestor = {
      id: 'inv-123',
      tenant_id: 'tenant-1',
      email: 'investor@example.com',
      kyc_status: KycStatus.Pending,
    };

    prisma.investor.findUnique.mockResolvedValue(mockInvestor);
    prisma.webhookEvent.findFirst.mockResolvedValue(null);

    const result = await service.getKycStatus('inv-123', mockJwt);

    expect(result.last_webhook_event_at).toBeNull();
  });

  it('throws NotFoundException when the investor does not exist (404)', async () => {
    prisma.investor.findUnique.mockResolvedValue(null);

    await expect(service.getKycStatus('unknown-inv', mockJwt)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ForbiddenException when investor tenant_id does not match JWT tenant_id (403)', async () => {
    const mockInvestor = {
      id: 'inv-123',
      tenant_id: 'tenant-DIFFERENT',
      email: 'investor@example.com',
      kyc_status: KycStatus.Approved,
    };

    prisma.investor.findUnique.mockResolvedValue(mockInvestor);

    await expect(service.getKycStatus('inv-123', mockJwt)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

