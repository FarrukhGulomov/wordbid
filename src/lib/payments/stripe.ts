import Stripe from 'stripe';
import type { CheckoutRequest, CheckoutSession, PaymentProvider, WebhookEvent } from './types';

/**
 * Stripe Checkout implementation.
 *
 * Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. The webhook signature is verified
 * against the raw request body — never a re-serialised object.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private client: Stripe;
  private webhookSecret: string;
  private currency: string;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    this.client = new Stripe(key);
    this.webhookSecret = webhookSecret;
    this.currency = process.env.STRIPE_CURRENCY || 'usd';
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const session = await this.client.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: this.currency,
              unit_amount: req.amountCents,
              product_data: {
                name: `Own "${req.wordDisplay}" on OwnTheInternet`,
                description:
                  `Placement for ${req.brandName} on the word "${req.wordDisplay}". ` +
                  'Temporary placement on this platform only. Not legal ownership of the word. ' +
                  'Another brand can take it at any time by paying more.',
              },
            },
          },
        ],
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        // Our own id, echoed back on the event so the webhook needs no extra lookup.
        client_reference_id: req.paymentId,
        metadata: { paymentId: req.paymentId },
      },
      // Stripe-side guard against a double-submitted checkout creating two sessions.
      { idempotencyKey: `checkout_${req.paymentId}` },
    );

    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { reference: session.id, redirectUrl: session.url };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent> {
    const signature = headers.get('stripe-signature');
    if (!signature) throw new Error('Missing stripe-signature header');

    // Throws on an invalid signature or a timestamp outside Stripe's tolerance.
    const event = await this.client.webhooks.constructEventAsync(
      rawBody,
      signature,
      this.webhookSecret,
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // `complete` status with an unpaid session means the money is not captured yet.
        if (session.payment_status !== 'paid') return { kind: 'ignored', eventId: event.id };
        return {
          kind: 'payment_succeeded',
          eventId: event.id,
          reference: session.id,
          amountCents: session.amount_total ?? 0,
        };
      }
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        return {
          kind: 'payment_succeeded',
          eventId: event.id,
          reference: session.id,
          amountCents: session.amount_total ?? 0,
        };
      }
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const session = event.data.object;
        return { kind: 'payment_failed', eventId: event.id, reference: session.id };
      }
      default:
        return { kind: 'ignored', eventId: event.id };
    }
  }

  async refund(reference: string, amountCents: number): Promise<void> {
    const session = await this.client.checkout.sessions.retrieve(reference);
    const paymentIntent =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntent) throw new Error(`No payment intent on Stripe session ${reference}`);

    await this.client.refunds.create(
      { payment_intent: paymentIntent, amount: amountCents },
      { idempotencyKey: `refund_${reference}` },
    );
  }
}
