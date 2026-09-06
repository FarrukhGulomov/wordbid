import crypto from 'node:crypto';
import { config } from '../config';
import type { CheckoutRequest, CheckoutSession, PaymentProvider, WebhookEvent } from './types';

/**
 * NOWPayments (crypto) checkout, on the exact same PaymentProvider interface Stripe and the
 * mock provider already implement — see src/lib/payments/types.ts. Requires
 * NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET; both are placeholders only in this repo (see
 * .env.example) and this class throws at construction if either is missing, exactly like
 * StripePaymentProvider does for its own keys. No real credentials or wallet addresses are
 * shipped anywhere in this codebase — enabling real crypto payments is entirely an operator
 * configuration step, documented in README's "Connecting NOWPayments".
 */

const API_BASE = 'https://api.nowpayments.io/v1';

/** The subset of NOWPayments' documented payment_status values this integration acts on. */
type NowPaymentsStatus =
  | 'waiting'
  | 'confirming'
  | 'confirmed'
  | 'sending'
  | 'partially_paid'
  | 'finished'
  | 'failed'
  | 'refunded'
  | 'expired';

/**
 * NOWPayments signs an IPN body over its keys sorted alphabetically at every level, then
 * `JSON.stringify`d with no extra whitespace — verification must reproduce that exact canonical
 * form byte-for-byte before hashing, or every real signature would fail to match.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export class NowPaymentsProvider implements PaymentProvider {
  readonly name = 'nowpayments';
  private apiKey: string;
  private ipnSecret: string;

  constructor() {
    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!apiKey) throw new Error('NOWPAYMENTS_API_KEY is not set');
    if (!ipnSecret) throw new Error('NOWPAYMENTS_IPN_SECRET is not set');
    this.apiKey = apiKey;
    this.ipnSecret = ipnSecret;
  }

  /**
   * Creates a hosted NOWPayments invoice — the buyer picks their coin on NOWPayments' own page,
   * same "redirect to the provider" shape Stripe Checkout already uses. `order_id` carries our
   * own Payment.id through for traceability, but the correlation key this integration actually
   * relies on is the invoice's own `id` (returned here as `reference`, stored as
   * Payment.providerReference) — that is the field NOWPayments echoes back as `invoice_id` on
   * every IPN for this invoice, so lookup by providerReference works exactly like every other
   * provider, with no NOWPayments-specific branching anywhere outside this file.
   */
  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const res = await fetch(`${API_BASE}/invoice`, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_amount: req.amountCents / 100,
        price_currency: 'usd',
        order_id: req.paymentId,
        order_description: `${req.brandName} — "${req.wordDisplay}" on WordBid`,
        ipn_callback_url: `${config.siteUrl}/api/webhooks/payments`,
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`NOWPayments invoice creation failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as { id?: string | number; invoice_url?: string };
    if (!data.id || !data.invoice_url) {
      throw new Error('NOWPayments did not return an invoice id/url');
    }
    return { reference: String(data.id), redirectUrl: data.invoice_url };
  }

  /**
   * Verifies an IPN's `x-nowpayments-sig` header and maps its `payment_status` to our three
   * outcomes. Only `finished` is treated as money actually captured — `confirmed` means
   * on-chain confirmations were reached but NOWPayments has not yet finished settling/crediting
   * the payment, so treating it as success early would risk granting ownership before the money
   * is truly final. `failed` and `expired` both mean the buyer will never complete this payment.
   * Everything else (`waiting`, `confirming`, `sending`, `partially_paid`, `refunded`, or any
   * status this integration doesn't recognise) is acknowledged but not yet actionable.
   */
  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent> {
    const signature = headers.get('x-nowpayments-sig');
    if (!signature) throw new Error('Missing x-nowpayments-sig header');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error('Malformed NOWPayments IPN payload: invalid JSON');
    }

    const canonical = JSON.stringify(sortKeysDeep(parsed));
    const expected = crypto.createHmac('sha512', this.ipnSecret).update(canonical).digest('hex');
    const given = Buffer.from(signature, 'hex');
    const want = Buffer.from(expected, 'hex');
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      throw new Error('Invalid NOWPayments IPN signature');
    }

    const invoiceId = parsed.invoice_id;
    const paymentId = parsed.payment_id;
    const reference =
      invoiceId !== undefined && invoiceId !== null
        ? String(invoiceId)
        : paymentId !== undefined && paymentId !== null
          ? String(paymentId)
          : undefined;
    const status = parsed.payment_status as NowPaymentsStatus | undefined;
    if (!reference || !status) {
      throw new Error('Malformed NOWPayments IPN payload: missing invoice_id/payment_id or payment_status');
    }

    // A single payment posts several IPNs as it moves through the statuses above — each a
    // distinct real event the same (provider, eventId) idempotency guard in confirmPayment must
    // treat as such, while an exact retry of the SAME status transition must still dedupe.
    const eventId = `${reference}:${status}`;

    // Informational only: confirmPayment always re-derives the truth from our own stored
    // Payment.amountCents, in our own currency, never from a webhook's own reported amount (see
    // src/lib/ownership.ts) — this exists only so a NOWPayments WebhookEvent has the same shape
    // every other provider's already does, for logging/inspection.
    const priceAmount = Number(parsed.price_amount);
    const amountCents = Number.isFinite(priceAmount) ? Math.round(priceAmount * 100) : 0;

    if (status === 'finished') {
      return { kind: 'payment_succeeded', eventId, reference, amountCents };
    }
    if (status === 'failed' || status === 'expired') {
      return { kind: 'payment_failed', eventId, reference };
    }
    return { kind: 'ignored', eventId };
  }

  /**
   * A crypto payment can only be refunded to a wallet address, and this minimal integration
   * never collects one from the buyer — there is nowhere to send money back to. Throwing here
   * (rather than silently pretending to succeed) is what keeps a losing NOWPayments payment
   * visible in /admin's "REFUNDS NEEDING ATTENTION" list for a human to resolve directly in the
   * NOWPayments dashboard — reconcileRefund already catches and reports exactly this case.
   */
  async refund(): Promise<void> {
    throw new Error(
      'NOWPayments refunds require a buyer-supplied return address, which this integration does not collect. Refund manually in the NOWPayments dashboard.',
    );
  }
}
