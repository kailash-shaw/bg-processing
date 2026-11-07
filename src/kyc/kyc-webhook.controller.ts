import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBody,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycWebhookDto } from './dto/kyc-webhook.dto';
import { KycWebhookResponse } from '../common/interfaces/webhook.interface';
import {
  KYC_PROVIDER_NAME,
  KYC_SIGNATURE_HEADER,
} from '../common/constants/kyc.constants';
import { verifyKycWebhookSignature } from '../common/utils/kyc-signature.util';
import { KycWebhookService } from './kyc-webhook.service';

@Controller('webhooks')
export class KycWebhookController {
  private readonly logger = new Logger(KycWebhookController.name);

  constructor(
    private readonly kycWebhookService: KycWebhookService,
    private readonly configService: ConfigService,
  ) {}

  @Post('kyc')
  @HttpCode(HttpStatus.OK)
  async handleKycWebhook(
    @Body() payload: KycWebhookDto,
    @Headers(KYC_SIGNATURE_HEADER) signature: string,
    @RawBody() rawBody: Buffer,
  ): Promise<KycWebhookResponse> {
    const isSignatureValid = verifyKycWebhookSignature(
      rawBody,
      signature,
      this.configService.get<string>('KYC_WEBHOOK_SECRET') ?? '',
    );

    if (!isSignatureValid) {
      this.logger.warn(
        `KYC webhook signature verification failed for event ${payload?.event_id ?? 'unknown'}`,
      );
      throw new UnauthorizedException('Invalid KYC webhook signature');
    }

    const isDuplicate = await this.kycWebhookService.tryAcquireEventId(
      payload.event_id,
    );

    if (isDuplicate) {
      this.logger.log(
        `KYC webhook event ${payload.event_id} was already processed`,
      );
      return { received: true };
    }

    await this.kycWebhookService.enqueueStatusUpdate({
      eventId: payload.event_id,
      investorId: payload.investor_id,
      newStatus: payload.new_status,
      timestamp: payload.timestamp,
      provider: KYC_PROVIDER_NAME,
      payload: {
        event_id: payload.event_id,
        investor_id: payload.investor_id,
        new_status: payload.new_status,
        timestamp: payload.timestamp,
      },
    });

    return { received: true };
  }
}
