import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const sessionsRetrieve = vi.fn();
const refundsCreate = vi.fn();

vi.mock('stripe', () => {
  return {
    default: class FakeStripe {
      checkout = { sessions: { retrieve: sessionsRetrieve } };
      refunds = { create: refundsCreate };
    },
  };
});

async function loadProvider() {
  const { StripePaymentProvider } = await import('@/lib/payments/stripe');
  return new StripePaymentProvider();
}

describe('StripePaymentProvider.refund — F06', () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    sessionsRetrieve.mockReset().mockResolvedValue({ payment_intent: 'pi_123' });
    refundsCreate.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  it('reports "succeeded" only when Stripe actually confirms the refund completed', async () => {
    refundsCreate.mockResolvedValue({ id: 're_1', status: 'succeeded' });
    const provider = await loadProvider();
    await expect(provider.refund('cs_1', 1000)).resolves.toBe('succeeded');
  });

  // F06: the old implementation discarded Stripe's refund object entirely and the caller
  // (reconcileRefund) always marked the payment REFUNDED right after `refunds.create` resolved —
  // even though Stripe can accept a refund and report it `pending` (common for bank-debit and
  // some non-instant payment methods) well before the money has actually moved. That told a
  // buyer "refunded in full" when it might not even be attempted yet.
  it('reports "pending" — never "succeeded" — for a refund Stripe has not yet completed', async () => {
    refundsCreate.mockResolvedValue({ id: 're_2', status: 'pending' });
    const provider = await loadProvider();
    await expect(provider.refund('cs_1', 1000)).resolves.toBe('pending');
  });

  it('reports "pending" for a refund requiring further action', async () => {
    refundsCreate.mockResolvedValue({ id: 're_3', status: 'requires_action' });
    const provider = await loadProvider();
    await expect(provider.refund('cs_1', 1000)).resolves.toBe('pending');
  });

  it('throws (never resolves as succeeded) for a refund Stripe reports as failed', async () => {
    refundsCreate.mockResolvedValue({ id: 're_4', status: 'failed' });
    const provider = await loadProvider();
    await expect(provider.refund('cs_1', 1000)).rejects.toThrow(/failed/);
  });
});
