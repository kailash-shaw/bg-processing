import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/interfaces/jwt.interface';
import { InvestorKycStatusResponse } from '../common/interfaces/investor-kyc-status.interface';
import { KycStatus } from '../common/interfaces/kyc-status.interface';

@Injectable()
export class InvestorService {
  constructor(private readonly prisma: PrismaService) {}

  async getKycStatus(
    investorId: string,
    jwt: JwtPayload,
  ): Promise<InvestorKycStatusResponse> {
    const investor = await this.prisma.investor.findUnique({
      where: { id: investorId },
    });

    if (!investor) {
      throw new NotFoundException(
        `Investor with id ${investorId} was not found`,
      );
    }

    if (investor.tenant_id !== jwt.tenant_id) {
      throw new ForbiddenException(
        'Investor does not belong to the authenticated tenant',
      );
    }

    const lastEvent = await this.prisma.webhookEvent.findFirst({
      where: { investor_id: investorId },
      orderBy: { processed_at: 'desc' },
    });

    const lastWebhookEventAt = lastEvent
      ? lastEvent.processed_at.toISOString()
      : null;

    return {
      id: investor.id,
      investor_id: investor.id,
      email: investor.email,
      kyc_status: investor.kyc_status as KycStatus,
      last_webhook_event_at: lastWebhookEventAt,
    };
  }
}
