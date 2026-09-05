import crypto from 'node:crypto';
import type { CheckoutRequest, CheckoutSession, PaymentProvider, WebhookEvent } from './types';

/**
 * Local development provider. No external service and no card details.
 *
 * Checkout redirects to an in-app sandbox page with "Pay" and "Cancel" buttons which
 * post a signed event to the same webhook endpoint the real provider uses, so the
 * confirmation path exercised in development is the production path.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private get secret(): string {
    return process.env.MOCK_WEBHOOK_SECRET || process.env.CLICK_HASH_SALT || 'mock-secret';
  }

  /** Signature used by the sandbox page so the webhook still verifies something real. */
  sign(body: string): string {
    return crypto.createHmac('sha256', this.secret).update(body).digest('hex');
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const reference = `mock_${crypto.randomUUID()}`;
    // Only the payment id travels in the URL. The sandbox reads everything else from the
    // database, so there is no attacker-controlled redirect target.
    const url = new URL(
      `/checkout/sandbox?payment=${encodeURIComponent(req.paymentId)}`,
      process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    );
    return { reference, redirectUrl: url.toString() };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent> {
    const signature = headers.get('x-mock-signature');
    if (!signature) throw new Error('Missing x-mock-signature header');

    const expected = this.sign(rawBody);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error('Invalid mock webhook signature');
    }

    const parsed = JSON.parse(rawBody) as {
      eventId?: string;
      type?: string;
      reference?: string;
      amountCents?: number;
    };
    if (!parsed.eventId || !parsed.reference) throw new Error('Malformed mock webhook payload');

    if (parsed.type === 'payment_succeeded') {
      return {
        kind: 'payment_succeeded',
        eventId: parsed.eventId,
        reference: parsed.reference,
        amountCents: Number(parsed.amountCents ?? 0),
      };
    }
    if (parsed.type === 'payment_failed') {
      return { kind: 'payment_failed', eventId: parsed.eventId, reference: parsed.reference };
    }
    return { kind: 'ignored', eventId: parsed.eventId };
  }

  async refund(): Promise<void> {
    // No money actually moved, so there is nothing to return. The Payment row is still
    // marked REFUNDED so the buyer-facing copy and the admin view stay truthful.
  }
}
