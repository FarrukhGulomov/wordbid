/**
 * Payment provider abstraction.
 *
 * Everything the rest of the app knows about payments is in this interface, so swapping
 * Stripe for another processor means writing one new file and changing one env var.
 */

export interface CheckoutRequest {
  /** Our Payment row id. Round-tripped through the provider so the webhook can find it. */
  paymentId: string;
  amountCents: number;
  /** Shown on the provider's checkout page. */
  wordDisplay: string;
  brandName: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Provider-side identifier, stored as Payment.providerReference. */
  reference: string;
  /** Where the buyer must be sent to pay. */
  redirectUrl: string;
}

/** The normalised result of verifying an incoming webhook request. */
export type WebhookEvent =
  | { kind: 'payment_succeeded'; eventId: string; reference: string; amountCents: number }
  | { kind: 'payment_failed'; eventId: string; reference: string }
  | { kind: 'ignored'; eventId: string };

export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Verifies the signature of a raw webhook body and normalises it.
   * Throws when the signature is missing or invalid — the caller must reject with 400.
   */
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent>;
  /** Returns money for a captured payment that did not win the word. */
  refund(reference: string, amountCents: number): Promise<void>;
}
