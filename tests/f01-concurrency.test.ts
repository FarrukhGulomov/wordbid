import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { db, resetDb, seedPendingPayment, seedBoostPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Forces two concurrent confirmPayment calls touching the SAME word to interleave at exactly
 * the point ownership.ts's own row lock (`SELECT ... FOR UPDATE` on Word) would serialize them —
 * by holding that same lock open ourselves first, in a third transaction, until we've *observed*
 * (via pg_stat_activity — never a fixed sleep) that both confirmPayment transactions are already
 * blocked waiting for it. Only then do we release it.
 *
 * This deterministically reproduces the interleaving a real concurrent redelivery could hit —
 * both racers commit to their own "payment is still PENDING" read before either one is allowed
 * to proceed past the lock — without touching production code, mocking the database, or hoping
 * Promise.all's natural scheduling happens to hit the window.
 */
async function raceOnWordLock<T>(wordId: string, racers: () => [Promise<T>, Promise<T>]): Promise<[T, T]> {
  const held = deferred();
  const release = deferred<void>();

  const holder = db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Word" WHERE id = ${wordId} FOR UPDATE`;
      held.resolve();
      await release.promise;
    },
    { timeout: 20_000, maxWait: 20_000 },
  );

  await held.promise;

  const [a, b] = racers();

  // Postgres queues row-lock waiters FIFO: the second racer waits on the FIRST racer's
  // transaction, not directly on ours, so only one backend ever shows wait_event =
  // 'transactionid' at a time. Both are still genuinely blocked on the same FOR UPDATE
  // statement, which is what we actually need — detected here by both backends still being
  // "active" (not yet returned control to their callback) while running that exact query.
  const deadline = Date.now() + 5000;
  for (;;) {
    const rows = await db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'active' AND query LIKE '%FOR UPDATE%'
    `;
    if (rows[0]!.count >= 2) break;
    if (Date.now() > deadline) {
      release.resolve();
      throw new Error(
        'Timed out waiting for both confirmPayment calls to block on the held Word lock — ' +
          'the race window could not be set up, so no conclusion about F01 can be drawn from this run.',
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }

  release.resolve();
  const results = await Promise.all([a, b]);
  await holder;
  return results;
}

describe('F01 — two different success event IDs racing the SAME PENDING payment', () => {
  it('TAKEOVER: never produces more than one applied entitlement', async () => {
    const { word, payment } = await seedPendingPayment({ word: 'race', brand: 'A', amountCents: 4000 });

    const [r1, r2] = await raceOnWordLock(word.id, () => [
      confirmPayment('mock', 'evt_x', payment.providerReference, db),
      confirmPayment('mock', 'evt_y', payment.providerReference, db),
    ]);

    const wonCount = [r1, r2].filter((r) => r.outcome === 'won').length;
    const ownershipCount = await db.ownership.count({ where: { paymentId: payment.id } });
    const finalPayment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });

    console.log('F01 TAKEOVER race result:', {
      outcomes: [r1.outcome, r2.outcome],
      wonCount,
      ownershipCount,
      finalStatus: finalPayment.status,
    });

    expect(wonCount).toBeLessThanOrEqual(1);
    expect(ownershipCount).toBeLessThanOrEqual(1);
    if (wonCount === 1) {
      // A payment that won must never ALSO be downgraded to REFUND_PENDING by its own duplicate.
      expect(finalPayment.status).toBe('CONFIRMED');
    }
  });

  it('BOOST: the paid delta is never applied twice', async () => {
    const { word, owner, payment } = await seedPendingPayment({ word: 'race', brand: 'A', amountCents: 1000 });
    await confirmPayment('mock', 'evt_claim', payment.providerReference, db);
    const before = await db.word.findUniqueOrThrow({ where: { id: word.id } });

    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 500 });

    const [r1, r2] = await raceOnWordLock(word.id, () => [
      confirmPayment('mock', 'evt_boost_x', boost.providerReference, db),
      confirmPayment('mock', 'evt_boost_y', boost.providerReference, db),
    ]);

    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    const applied = after.valueCents - before.valueCents;

    console.log('F01 BOOST race result:', {
      outcomes: [r1.outcome, r2.outcome],
      beforeValue: before.valueCents,
      afterValue: after.valueCents,
      appliedDelta: applied,
      expectedIfSafe: 500,
      expectedIfDoubleApplied: 1000,
    });

    expect(applied).toBe(500);
  });
});
