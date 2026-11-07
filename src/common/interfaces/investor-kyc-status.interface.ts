import { KycStatus } from './kyc-status.interface';

export interface InvestorKycStatusResponse {
  id: string;
  investor_id: string;
  email: string;
  kyc_status: KycStatus;
  /** ISO timestamp of the most recent webhook event for this investor, if one exists */
  last_webhook_event_at: string | null;
}
