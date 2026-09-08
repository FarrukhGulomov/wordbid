import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { reconcileRefund, reconcileAllPendingRefunds } from '@/lib/refunds';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

describe('reconcileRefund', () => {
  it('refunds a payment stuck REFUND_PENDING and marks it REFUNDED', async () => {
    const winner = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 2000 });
    const loser = await seedPendingPayment({ word: 'coding', brand: 'SlowCo', amountCents: 1500 });
    await confirmPayment('mock', 'evt_win', winner.payment.providerReference, db);
    const result = await confirmPayment('mock', 'evt_lose', loser.payment.providerReference, db);
    expect(result.outcome).toBe('lost');

    const before = await db.payment.findUniqueOrThrow({ where: { id: loser.payment.id } });
    expect(before.status).toBe('REFUND_PENDING');

    const outcome = await reconcileRefund(loser.payment.id);
    expect(outcome).toEqual({ paymentId: loser.payment.id, outcome: 'refunded' });

    const after = await db.payment.findUniqueOrThrow({ where: { id: loser.payment.id } });
    expect(after.status).toBe('REFUNDED');
    expect(after.refundedAt).not.toBeNull();
  });

  it('is a no-op on a payment that is not REFUND_PENDING', async () => {
    const { payment } = await seedPendingPayment({ word: 'ai', brand: 'AcmeAI', amountCents: 1000 });
    await confirmPayment('mock', 'evt_ok', payment.providerReference, db);

    const outcome = await reconcileRefund(payment.id);
    expect(outcome).toEqual({ paymentId: payment.id, outcome: 'skipped' });

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('CONFIRMED');
  });

  it('is safe to call twice — the second call is a no-op, not a double refund', async () => {
    const winner = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 2000 });
    const loser = await seedPendingPayment({ word: 'coding', brand: 'SlowCo', amountCents: 1500 });
    await confirmPayment('mock', 'evt_win', winner.payment.providerReference, db);
    await confirmPayment('mock', 'evt_lose', loser.payment.providerReference, db);

    const first = await reconcileRefund(loser.payment.id);
    const second = await reconcileRefund(loser.payment.id);
    expect(first.outcome).toBe('refunded');
    expect(second.outcome).toBe('skipped');
  });

  it('reports failure without throwing when the provider call rejects, leaving REFUND_PENDING', async () => {
    const { getPaymentProvider } = await import('@/lib/payments');
    const spy = vi
      .spyOn(getPaymentProvider(), 'refund')
      .mockRejectedValueOnce(new Error('provider unreachable'));

    const winner = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 2000 });
    const loser = await seedPendingPayment({ word: 'coding', brand: 'SlowCo', amountCents: 1500 });
    await confirmPayment('mock', 'evt_win', winner.payment.providerReference, db);
    await confirmPayment('mock', 'evt_lose', loser.payment.providerReference, db);

    const outcome = await reconcileRefund(loser.payment.id);
    expect(outcome.outcome).toBe('failed');
    if (outcome.outcome === 'failed') expect(outcome.error).toContain('provider unreachable');

    const after = await db.payment.findUniqueOrThrow({ where: { id: loser.payment.id } });
    expect(after.status).toBe('REFUND_PENDING');

    spy.mockRestore();
  });
});

// F09: reconcileRefund must ask the SAME provider that captured the payment, not whichever one
// happens to be configured right now — an operator can migrate PAYMENT_PROVIDER after some
// payments were already made under a different one.
describe('reconcileRefund — F09: refunds route to the payment\'s OWN provider', () => {
  it('never calls the currently-configured provider\'s refund for a payment made under a different one', async () => {
    const { getPaymentProvider, getPaymentProviderByName } = await import('@/lib/payments');
    // Current config is 'mock' (see .env.test) — spy on it to prove it is never touched below.
    const currentSpy = vi.spyOn(getPaymentProvider(), 'refund');

    const winner = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 2000 });
    const loser = await seedPendingPayment({ word: 'coding', brand: 'SlowCo', amountCents: 1500 });
    await confirmPayment('mock', 'evt_win', winner.payment.providerReference, db);
    await confirmPayment('mock', 'evt_lose', loser.payment.providerReference, db);

    // Simulate a payment that was actually made under a DIFFERENT provider than the one
    // currently configured (e.g. after an operator migration) — 'other' has no real
    // implementation, so a call routed to it (correct) throws a distinct, recognisable error,
    // while a call misrouted to the current 'mock' provider (the bug) would silently succeed.
    await db.payment.update({ where: { id: loser.payment.id }, data: { provider: 'other' } });

    const otherSpy = vi.spyOn(getPaymentProviderByName('mock'), 'refund');

    const outcome = await reconcileRefund(loser.payment.id);
    expect(outcome.outcome).toBe('failed');
    if (outcome.outcome === 'failed') expect(outcome.error).toContain('Unknown payment provider "other"');
    expect(currentSpy).not.toHaveBeenCalled();
    expect(otherSpy).not.toHaveBeenCalled();

    currentSpy.mockRestore();
    otherSpy.mockRestore();
  });
});

describe('reconcileAllPendingRefunds', () => {
  it('retries every stuck payment and leaves confirmed ones untouched', async () => {
    const winnerA = await seedPendingPayment({ word: 'ai', brand: 'AcmeAI', amountCents: 5000 });
    await confirmPayment('mock', 'e1', winnerA.payment.providerReference, db);
    const loserA = await seedPendingPayment({ word: 'ai', brand: 'Slow1', amountCents: 4000 });
    await confirmPayment('mock', 'e2', loserA.payment.providerReference, db);

    const winnerB = await seedPendingPayment({ word: 'video', brand: 'VideoX', amountCents: 3000 });
    await confirmPayment('mock', 'e3', winnerB.payment.providerReference, db);
    const loserB = await seedPendingPayment({ word: 'video', brand: 'Slow2', amountCents: 2500 });
    await confirmPayment('mock', 'e4', loserB.payment.providerReference, db);

    const results = await reconcileAllPendingRefunds();
    expect(results.filter((r) => r.outcome === 'refunded')).toHaveLength(2);

    const pendingCount = await db.payment.count({ where: { status: 'REFUND_PENDING' } });
    expect(pendingCount).toBe(0);
    const confirmedCount = await db.payment.count({ where: { status: 'CONFIRMED' } });
    expect(confirmedCount).toBe(2);
  });

  it('returns an empty list when nothing is pending', async () => {
    expect(await reconcileAllPendingRefunds()).toEqual([]);
  });
});
