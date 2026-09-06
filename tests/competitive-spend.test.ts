import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { isFirstClaimPayment, getWordCompetitiveSpend } from '@/lib/queries';
import { db, resetDb, seedPendingPayment, seedBoostPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function claim(word: string, brand: string, amountCents: number, eventId: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents });
  const result = await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  expect(result.outcome).toBe('won');
  return seeded;
}

describe('isFirstClaimPayment', () => {
  it('is true for the payment that first claimed a word', async () => {
    const { payment } = await claim('ai', 'AcmeAI', 1000, 'e1');
    expect(await isFirstClaimPayment(payment.id)).toBe(true);
  });

  it('is false for a later takeover payment on the same word', async () => {
    await claim('coding', 'DevX', 1000, 'e1');
    const second = await seedPendingPayment({ word: 'coding', brand: 'CodeAI', amountCents: 2000 });
    await confirmPayment('mock', 'e2', second.payment.providerReference, db);

    expect(await isFirstClaimPayment(second.payment.id)).toBe(false);
  });

  it('is false for a payment that never won (no ownership was ever created for it)', async () => {
    const { payment } = await seedPendingPayment({ word: 'ai', brand: 'Ghost', amountCents: 1000 });
    // Never confirmed — no Ownership row exists for this payment.
    expect(await isFirstClaimPayment(payment.id)).toBe(false);
  });

  it('is false for a BOOST payment, which never creates its own ownership', async () => {
    const { word, owner } = await claim('ai', 'AcmeAI', 1000, 'e1');
    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 500 });
    await confirmPayment('mock', 'e2', boost.providerReference, db);

    expect(await isFirstClaimPayment(boost.id)).toBe(false);
  });
});

describe('getWordCompetitiveSpend', () => {
  it('is all zero for a word that has only ever had one owner', async () => {
    const { word } = await claim('ai', 'AcmeAI', 1000, 'e1');
    expect(await getWordCompetitiveSpend(word.id)).toEqual({
      takeoverCount: 0,
      takeoverSpendCents: 0,
      boostSpendCents: 0,
      competitiveSpendCents: 0,
    });
  });

  it('never counts the initial claim, only takeovers after it', async () => {
    const { word } = await claim('coding', 'DevX', 1000, 'e1');
    const second = await seedPendingPayment({ word: 'coding', brand: 'CodeAI', amountCents: 2000 });
    await confirmPayment('mock', 'e2', second.payment.providerReference, db);
    const third = await seedPendingPayment({ word: 'coding', brand: 'BuildX', amountCents: 3000 });
    await confirmPayment('mock', 'e3', third.payment.providerReference, db);

    const result = await getWordCompetitiveSpend(word.id);
    expect(result.takeoverCount).toBe(2);
    expect(result.takeoverSpendCents).toBe(5000); // 2000 + 3000, never the first claim's 1000
    expect(result.boostSpendCents).toBe(0);
    expect(result.competitiveSpendCents).toBe(5000);
  });

  it('counts confirmed boost spend on top of the initial claim', async () => {
    const { word, owner } = await claim('ai', 'AcmeAI', 1000, 'e1');
    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 500 });
    await confirmPayment('mock', 'e2', boost.providerReference, db);

    const result = await getWordCompetitiveSpend(word.id);
    expect(result.takeoverCount).toBe(0);
    expect(result.takeoverSpendCents).toBe(0);
    expect(result.boostSpendCents).toBe(500);
    expect(result.competitiveSpendCents).toBe(500);
  });

  it('does not double-count a boost applied to a non-first ownership (the real trap)', async () => {
    // The trap: Ownership.amountCents is mutated in place by a boost. If "takeover spend" were
    // computed by summing Ownership.amountCents for every ownership after the first, a takeover
    // that was later boosted would already carry that boost money baked into its amountCents —
    // and boostSpendCents would then add the exact same money again. getWordCompetitiveSpend
    // must read Payment.amountCents (immutable) instead, never Ownership.amountCents.
    const { word } = await claim('coding', 'DevX', 1000, 'e1'); // ownership #1 (claim) @ 1000

    const takeover = await seedPendingPayment({ word: 'coding', brand: 'CodeAI', amountCents: 2000 });
    await confirmPayment('mock', 'e2', takeover.payment.providerReference, db); // ownership #2 @ 2000

    const afterTakeover = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    const boost = await seedBoostPayment({
      wordId: word.id,
      ownerId: afterTakeover.currentOwnershipId
        ? (await db.ownership.findUniqueOrThrow({ where: { id: afterTakeover.currentOwnershipId } })).ownerId
        : takeover.owner.id,
      amountCents: 500,
    });
    await confirmPayment('mock', 'e3', boost.providerReference, db); // ownership #2 mutated to @ 2500

    const boostedWord = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(boostedWord.valueCents).toBe(2500);

    const result = await getWordCompetitiveSpend(word.id);
    expect(result.takeoverCount).toBe(1);
    // The takeover payment's own immutable amount — never 2000 + 500 inherited from ownership
    // #2's now-2500 amountCents.
    expect(result.takeoverSpendCents).toBe(2000);
    expect(result.boostSpendCents).toBe(500);
    expect(result.competitiveSpendCents).toBe(2500);

    // Sanity check on the trap itself: naively summing every non-first Ownership.amountCents
    // gives 2500 (ownership #2's post-boost value) — which, added to boostSpendCents again,
    // would silently invent an extra 500 of "spend" that never happened as a second payment.
    const nonFirstOwnerships = await db.ownership.findMany({
      where: { wordId: word.id },
      orderBy: { startedAt: 'asc' },
      skip: 1,
    });
    const naiveTakeoverSpend = nonFirstOwnerships.reduce((sum, o) => sum + o.amountCents, 0);
    const naiveCompetitiveSpend = naiveTakeoverSpend + result.boostSpendCents;
    expect(naiveCompetitiveSpend).not.toBe(result.competitiveSpendCents);
    expect(naiveCompetitiveSpend).toBe(3000); // the bug this test guards against
  });

  it('excludes a pending (unconfirmed) boost or takeover from spend', async () => {
    const { word, owner } = await claim('ai', 'AcmeAI', 1000, 'e1');
    await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 500 }); // never confirmed
    await seedPendingPayment({ word: 'ai', brand: 'Ghost', amountCents: 5000 }); // never confirmed

    const result = await getWordCompetitiveSpend(word.id);
    expect(result).toEqual({
      takeoverCount: 0,
      takeoverSpendCents: 0,
      boostSpendCents: 0,
      competitiveSpendCents: 0,
    });
  });
});
