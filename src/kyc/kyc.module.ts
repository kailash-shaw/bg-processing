import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvestorController } from './investor.controller';
import { InvestorService } from './investor.service';
import { KycWebhookController } from './kyc-webhook.controller';
import { KycWebhookService } from './kyc-webhook.service';
import { KycWorkerService } from './kyc-worker.service';

@Module({
  imports: [AuthModule],
  controllers: [KycWebhookController, InvestorController],
  providers: [KycWebhookService, KycWorkerService, InvestorService],
})
export class KycModule {}
