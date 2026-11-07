import { KycStatus } from './kyc-status.interface';

/**
 * Payload sent by the KYC provider when an investor completes verification.
 * `event_id` is the provider-side unique identifier of the event, used for
 * idempotency and audit purposes.
 */
export type KycWebhookPayload = {
  event_id: string;
  investor_id: string;
  new_status: KycStatus;
  timestamp: string;
};

export interface KycWebhookResponse {
  received: true;
}

/**
 * Internal job payload pushed onto the BullMQ queue by the webhook handler.
 * Mirrors {@link KycWebhookPayload} with camelCased fields for the queue layer.
 */
export interface KycWebhookJobData {
  eventId: string;
  investorId: string;
  newStatus: KycStatus;
  timestamp: string;
  provider: string;
  payload: KycWebhookPayload;
}
