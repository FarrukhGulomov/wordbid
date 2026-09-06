import crypto from 'node:crypto';
import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { NowPaymentsProvider } from '@/lib/payments/nowpayments';
import { confirmPayment } from '@/lib/ownership';
import { db, resetDb, seedPendingPayment } from './helpers';

const API_KEY = 'test_api_key';
const IPN_SECRET = 'test_ipn_secret';

beforeEach(async () => {
  await resetDb();
  process.env.NOWPAYMENTS_API_KEY = API_KEY;
  process.env.NOWPAYMENTS_IPN_SECRET = IPN_SECRET;
});
afterAll(async () => {
  await db.$disconnect();
});

/** Reimplements NOWPayments' own documented IPN signing algorithm independently of the
 * provider under test, so a test passing actually proves the provider follows their real spec
 * — not just that it agrees with itself. */
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

function sign(secret: string, body: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortKeysDeep(body));
  return crypto.createHmac('sha512', secret).update(canonical).digest('hex');
}

function ipnRequest(body: Record<string, unknown>, secret = IPN_SECRET) {
  const rawBody = JSON.stringify(body);
  const headers = new Headers({ 'x-nowpayments-sig': sign(secret, body) });
  return { rawBody, headers };
}

describe('NowPaymentsProvider — construction', () => {
  it('fails loudly when NOWPAYMENTS_API_KEY is missing', () => {
    delete process.env.NOWPAYMENTS_API_KEY;
    expect(() => new NowPaymentsProvider()).toThrow(/NOWPAYMENTS_API_KEY/);
  });

  it('fails loudly when NOWPAYMENTS_IPN_SECRET is missing', () => {
    delete process.env.NOWPAYMENTS_IPN_SECRET;
    expect(() => new NowPaymentsProvider()).toThrow(/NOWPAYMENTS_IPN_SECRET/);
  });
});

describe('NowPaymentsProvider — payment creation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a hosted invoice and returns its id/url as the checkout session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 5555555555, invoice_url: 'https://nowpayments.io/payment/?iid=5555555555' }), {
        status: 200,
      }),
    );

    const provider = new NowPaymentsProvider();
    const session = await provider.createCheckout({
      paymentId: 'pay_abc123',
      amountCents: 150000,
      wordDisplay: 'AI',
      brandName: 'Acme',
      successUrl: 'https://wordbid.example/checkout/result?payment=pay_abc123',
      cancelUrl: 'https://wordbid.example/word/ai?canceled=1',
    });

    expect(session).toEqual({ reference: '5555555555', redirectUrl: 'https://nowpayments.io/payment/?iid=5555555555' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.nowpayments.io/v1/invoice');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe(API_KEY);

    const body = JSON.parse(init!.body as string);
    expect(body.price_amount).toBe(1500); // 150000 cents -> 1500.00 usd
    expect(body.price_currency).toBe('usd');
    expect(body.order_id).toBe('pay_abc123');
    expect(body.ipn_callback_url).toContain('/api/webhooks/payments');
    expect(body.success_url).toBe('https://wordbid.example/checkout/result?payment=pay_abc123');
  });

  it('throws when NOWPayments responds with a non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Invalid API key', { status: 401 }));

    const provider = new NowPaymentsProvider();
    await expect(
      provider.createCheckout({
        paymentId: 'pay_1',
        amountCents: 1000,
        wordDisplay: 'AI',
        brandName: 'Acme',
        successUrl: 'https://x/success',
        cancelUrl: 'https://x/cancel',
      }),
    ).rejects.toThrow(/401/);
  });

  it('throws when the response has no invoice id or url', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const provider = new NowPaymentsProvider();
    await expect(
      provider.createCheckout({
        paymentId: 'pay_1',
        amountCents: 1000,
        wordDisplay: 'AI',
        brandName: 'Acme',
        successUrl: 'https://x/success',
        cancelUrl: 'https://x/cancel',
      }),
    ).rejects.toThrow(/did not return an invoice/);
  });
});

describe('NowPaymentsProvider — IPN verification', () => {
  it('accepts a correctly-signed "finished" callback as payment_succeeded', async () => {
    const provider = new NowPaymentsProvider();
    const { rawBody, headers } = ipnRequest({
      invoice_id: 5555555555,
      payment_id: 6066666666,
      payment_status: 'finished',
      price_amount: '150.00',
      price_currency: 'usd',
      order_id: 'pay_abc123',
    });

    const event = await provider.verifyWebhook(rawBody, headers);
    expect(event).toEqual({
      kind: 'payment_succeeded',
      eventId: '5555555555:finished',
      reference: '5555555555',
      amountCents: 15000,
    });
  });

  it('falls back to payment_id when invoice_id is absent', async () => {
    const provider = new NowPaymentsProvider();
    const { rawBody, headers } = ipnRequest({
      payment_id: 6066666666,
      payment_status: 'finished',
      price_amount: 10,
    });

    const event = await provider.verifyWebhook(rawBody, headers);
    if (event.kind !== 'payment_succeeded') throw new Error('expected payment_succeeded');
    expect(event.reference).toBe('6066666666');
  });

  it('rejects a request with no signature header', async () => {
    const provider = new NowPaymentsProvider();
    const rawBody = JSON.stringify({ invoice_id: 1, payment_status: 'finished' });
    await expect(provider.verifyWebhook(rawBody, new Headers())).rejects.toThrow(/Missing x-nowpayments-sig/);
  });

  it('rejects a request signed with the wrong secret', async () => {
    const provider = new NowPaymentsProvider();
    const { rawBody, headers } = ipnRequest({ invoice_id: 1, payment_status: 'finished' }, 'wrong_secret');
    await expect(provider.verifyWebhook(rawBody, headers)).rejects.toThrow(/Invalid NOWPayments IPN signature/);
  });

  it('rejects a body that was tampered with after signing', async () => {
    const provider = new NowPaymentsProvider();
    const { headers } = ipnRequest({ invoice_id: 1, payment_status: 'finished', price_amount: 10 });
    // Same signature, but a different body — the classic tamper attempt.
    const tamperedBody = JSON.stringify({ invoice_id: 1, payment_status: 'finished', price_amount: 999999 });
    await expect(provider.verifyWebhook(tamperedBody, headers)).rejects.toThrow(/Invalid NOWPayments IPN signature/);
  });

  it('rejects malformed JSON', async () => {
    const provider = new NowPaymentsProvider();
    const headers = new Headers({ 'x-nowpayments-sig': 'anything' });
    await expect(provider.verifyWebhook('not json', headers)).rejects.toThrow(/invalid JSON/);
  });

  it('rejects a well-signed payload missing invoice_id/payment_id or payment_status', async () => {
    const provider = new NowPaymentsProvider();
    const { rawBody, headers } = ipnRequest({ price_amount: 10 });
    await expect(provider.verifyWebhook(rawBody, headers)).rejects.toThrow(/Malformed NOWPayments IPN payload/);
  });

  it('maps failed and expired to payment_failed', async () => {
    const provider = new NowPaymentsProvider();

    const failed = ipnRequest({ invoice_id: 1, payment_status: 'failed' });
    expect(await provider.verifyWebhook(failed.rawBody, failed.headers)).toEqual({
      kind: 'payment_failed',
      eventId: '1:failed',
      reference: '1',
    });

    const expired = ipnRequest({ invoice_id: 2, payment_status: 'expired' });
    expect(await provider.verifyWebhook(expired.rawBody, expired.headers)).toEqual({
      kind: 'payment_failed',
      eventId: '2:expired',
      reference: '2',
    });
  });

  it.each(['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'refunded'])(
    'treats intermediate/out-of-scope status "%s" as ignored, never as success',
    async (status) => {
      const provider = new NowPaymentsProvider();
      const { rawBody, headers } = ipnRequest({ invoice_id: 1, payment_status: status });
      const event = await provider.verifyWebhook(rawBody, headers);
      expect(event.kind).toBe('ignored');
    },
  );
});

describe('NowPaymentsProvider — end-to-end through confirmPayment', () => {
  it('a confirmed callback actually grants ownership', async () => {
    const provider = new NowPaymentsProvider();
    const { word, payment } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 150000 });
    // The provider reference confirmPayment looks payments up by is whatever createCheckout
    // returned — simulate that having been the invoice id "5555555555" at checkout time.
    await db.payment.update({ where: { id: payment.id }, data: { providerReference: '5555555555' } });

    const { rawBody, headers } = ipnRequest({ invoice_id: 5555555555, payment_status: 'finished', price_amount: 1500 });
    const event = await provider.verifyWebhook(rawBody, headers);
    expect(event.kind).toBe('payment_succeeded');
    if (event.kind !== 'payment_succeeded') return;

    const result = await confirmPayment('nowpayments', event.eventId, event.reference, db);
    expect(result.outcome).toBe('won');

    const after = await db.word.findUniqueOrThrow({ where: { id: word.id }, include: { currentOwnership: true } });
    expect(after.valueCents).toBe(150000);
    expect(after.currentOwnership).not.toBeNull();
  });

  it('duplicate callback: redelivering the identical finished IPN is applied only once', async () => {
    const provider = new NowPaymentsProvider();
    const { payment } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 1000 });
    await db.payment.update({ where: { id: payment.id }, data: { providerReference: '777' } });

    const { rawBody, headers } = ipnRequest({ invoice_id: 777, payment_status: 'finished', price_amount: 10 });

    const first = await provider.verifyWebhook(rawBody, headers);
    const second = await provider.verifyWebhook(rawBody, headers);
    expect(first.eventId).toBe(second.eventId);
    if (first.kind !== 'payment_succeeded') throw new Error('expected payment_succeeded');
    if (second.kind !== 'payment_succeeded') throw new Error('expected payment_succeeded');

    const r1 = await confirmPayment('nowpayments', first.eventId, first.reference, db);
    const r2 = await confirmPayment('nowpayments', second.eventId, second.reference, db);
    expect(r1.outcome).toBe('won');
    expect(r2.outcome).toBe('duplicate');

    expect(await db.ownership.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it('a failed callback marks the payment failed without touching ranking', async () => {
    const provider = new NowPaymentsProvider();
    const { word, payment } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 1000 });
    await db.payment.update({ where: { id: payment.id }, data: { providerReference: '888' } });

    const { rawBody, headers } = ipnRequest({ invoice_id: 888, payment_status: 'failed' });
    const event = await provider.verifyWebhook(rawBody, headers);
    if (event.kind !== 'payment_failed') throw new Error('expected payment_failed');

    const { failPayment } = await import('@/lib/ownership');
    const result = await failPayment('nowpayments', event.eventId, event.reference, db);
    expect(result).toBe('failed');

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('FAILED');
    const wordAfter = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(wordAfter.currentOwnershipId).toBeNull();
  });

  it('an expired callback is handled the same safe way as failed', async () => {
    const provider = new NowPaymentsProvider();
    const { payment } = await seedPendingPayment({ word: 'ai', brand: 'Acme', amountCents: 1000 });
    await db.payment.update({ where: { id: payment.id }, data: { providerReference: '999' } });

    const { rawBody, headers } = ipnRequest({ invoice_id: 999, payment_status: 'expired' });
    const event = await provider.verifyWebhook(rawBody, headers);
    if (event.kind !== 'payment_failed') throw new Error('expected payment_failed');

    const { failPayment } = await import('@/lib/ownership');
    const result = await failPayment('nowpayments', event.eventId, event.reference, db);
    expect(result).toBe('failed');
  });

  it('race: two competing NOWPayments takeovers on the same word resolve to exactly one winner', async () => {
    const a = await seedPendingPayment({ word: 'race', brand: 'A', amountCents: 4000 });
    const b = await seedPendingPayment({ word: 'race', brand: 'B', amountCents: 4000 });
    await db.payment.update({ where: { id: a.payment.id }, data: { providerReference: 'inv_a' } });
    await db.payment.update({ where: { id: b.payment.id }, data: { providerReference: 'inv_b' } });

    const [ra, rb] = await Promise.all([
      confirmPayment('nowpayments', 'evt_a', 'inv_a', db),
      confirmPayment('nowpayments', 'evt_b', 'inv_b', db),
    ]);

    const outcomes = [ra.outcome, rb.outcome].sort();
    expect(outcomes).toEqual(['lost', 'won']);
    expect(await db.ownership.count({ where: { word: { normalized: 'race' } } })).toBe(1);
  });

  it('race: concurrent redeliveries of the same finished callback never double-apply', async () => {
    const { word, payment } = await seedPendingPayment({ word: 'cloud', brand: 'CloudCo', amountCents: 2500 });
    await db.payment.update({ where: { id: payment.id }, data: { providerReference: 'inv_cloud' } });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => confirmPayment('nowpayments', 'evt_race', 'inv_cloud', db)),
    );

    expect(results.filter((r) => r.outcome === 'won')).toHaveLength(1);
    expect(await db.ownership.count({ where: { wordId: word.id } })).toBe(1);
  });
});
