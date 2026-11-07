import { UnauthorizedException } from '@nestjs/common';
import { InvestorController } from './investor.controller';
import { InvestorService } from './investor.service';
import { KycStatus } from '../common/interfaces/kyc-status.interface';
import { JwtPayload } from '../common/interfaces/jwt.interface';

describe('InvestorController', () => {
  let controller: InvestorController;
  let service: { getKycStatus: jest.Mock };

  beforeEach(() => {
    service = {
      getKycStatus: jest.fn(),
    };
    controller = new InvestorController(service as unknown as InvestorService);
  });

  it('delegates to investorService when user is authenticated', async () => {
    const mockUser: JwtPayload = {
      sub: 'inv-123',
      tenant_id: 'tenant-1',
      investor_id: 'inv-123',
    };
    const expectedResponse = {
      id: 'inv-123',
      investor_id: 'inv-123',
      email: 'test@example.com',
      kyc_status: KycStatus.Approved,
      last_webhook_event_at: '2026-06-20T14:30:00.000Z',
    };
    service.getKycStatus.mockResolvedValue(expectedResponse);

    const result = await controller.getKycStatus(
      'inv-123',
      { user: mockUser } as any,
    );

    expect(result).toEqual(expectedResponse);
    expect(service.getKycStatus).toHaveBeenCalledWith('inv-123', mockUser);
  });

  it('throws UnauthorizedException if user context is missing from request', () => {
    expect(() =>
      controller.getKycStatus('inv-123', { user: undefined } as any),
    ).toThrow(UnauthorizedException);
  });
});

