import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { KycStatus } from '../../common/interfaces/kyc-status.interface';

export class KycWebhookDto {
  @IsString()
  @IsNotEmpty()
  event_id: string;

  @IsString()
  @IsNotEmpty()
  investor_id: string;

  @IsEnum(KycStatus)
  new_status: KycStatus;

  @IsString()
  @IsNotEmpty()
  timestamp: string;
}
