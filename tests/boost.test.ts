import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment, failPayment } from '@/lib/ownership';
import { db, resetDb, seedPendingPayment, seedBoostPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

describe('confirmPayment — boost', () => {
  it('raises the word value by only the difference charged, keeping the same ownership', async () => {
    const { word, owner, payment } = await seedPendingPayment({ word: 'video', brand: 'VideoX', amountCents: 1000 });
    await confirmPayment('mock', 'evt_claim', payment.providerReference, db);

    const before = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(before.currentOwnershipId).not.toBeNull();
    const ownershipId = before.currentOwnershipId!;
    const ownedSince = before.ownedSince;

    // Owner pays only the difference — 1625 cents, not the resulting 2625 total.
    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 1625 });
    const result = await confirmPayment('mock', 'evt_boost', boost.providerReference, db);

    expect(result).toMatchObject({ outcome: 'boosted', wordId: word.id, ownershipId, newValueCents: 2625 });

    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(after.valueCents).toBe(2625);
    // Same ownership period throughout — not a new one, and the tie-break timestamp is untouched.
    expect(after.currentOwnershipId).toBe(ownershipId);
    expect(after.ownedSince).toEqual(ownedSince);
    expect(await db.ownership.count({ where: { wordId: word.id } })).toBe(1);

    const ownership = await db.ownership.findUniqueOrThrow({ where: { id: ownershipId } });
    expect(ownership.amountCents).toBe(2625);

    const paid = await db.payment.findUniqueOrThrow({ where: { id: boost.id } });
    expect(paid.status).toBe('CONFIRMED');
    expect(paid.confirmedAt).not.toBeNull();
  });

  it('preserves the current ownership analytics — clicks, impressions and daily stats untouched', async () => {
    const { word, owner, payment } = await seedPendingPayment({ word: 'ai', brand: 'AcmeAI', amountCents: 5000 });
    await confirmPayment('mock', 'evt_claim', payment.providerReference, db);

    const ownershipId = (await db.word.findUniqueOrThrow({ where: { id: word.id } })).currentOwnershipId!;
    await db.ownership.update({
      where: { id: ownershipId },
      data: { clickCount: 42, impressionCount: 900 },
    });
    await db.ownershipDailyStat.create({
      data: { ownershipId, day: new Date('2026-01-01T00:00:00Z'), impressions: 10, clicks: 3 },
    });

    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 500 });
    const result = await confirmPayment('mock', 'evt_boost', boost.providerReference, db);
    expect(result.outcome).toBe('boosted');

    const ownership = await db.ownership.findUniqueOrThrow({ where: { id: ownershipId } });
    expect(ownership.clickCount).toBe(42);
    expect(ownership.impressionCount).toBe(900);
    // Only amountCents should have moved.
    expect(ownership.amountCents).toBe(5500);

    const daily = await db.ownershipDailyStat.findMany({ where: { ownershipId } });
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ impressions: 10, clicks: 3 });
  });

  it('a takeover after a boost still starts the new owner at zero analytics', async () => {
    const first = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 1000 });
    await confirmPayment('mock', 'evt_claim', first.payment.providerReference, db);

    const boostedOwnershipId = (
      await db.word.findUniqueOrThrow({ where: { id: first.word.id } })
    ).currentOwnershipId!;
    await db.ownership.update({ where: { id: boostedOwnershipId }, data: { clickCount: 20 } });
    const boost = await seedBoostPayment({ wordId: first.word.id, ownerId: first.owner.id, amountCents: 200 });
    await confirmPayment('mock', 'evt_boost', boost.providerReference, db);

    // A higher, later bid from a different brand takes the (now-boosted) word over.
    const boostedValue = (await db.word.findUniqueOrThrow({ where: { id: first.word.id } })).valueCents;
    const second = await seedPendingPayment({
      word: 'coding',
      brand: 'CodeAI',
      amountCents: boostedValue + 500,
    });
    const takeover = await confirmPayment('mock', 'evt_takeover', second.payment.providerReference, db);
    expect(takeover.outcome).toBe('won');

    const word = await db.word.findUniqueOrThrow({
      where: { id: first.word.id },
      include: { currentOwnership: { include: { owner: true } } },
    });
    expect(word.currentOwnership?.owner.name).toBe('CodeAI');
    expect(word.currentOwnership?.clickCount).toBe(0);
    expect(word.currentOwnership?.impressionCount).toBe(0);

    // History is preserved: the boosted period is closed, not deleted, and keeps its own numbers.
    const closed = await db.ownership.findUniqueOrThrow({ where: { id: boostedOwnershipId } });
    expect(closed.endedAt).not.toBeNull();
    expect(closed.clickCount).toBe(20);
    expect(await db.ownership.count({ where: { wordId: first.word.id } })).toBe(2);
  });

  it('a pending boost payment never changes the word value', async () => {
    const { word, owner, payment } = await seedPendingPayment({ word: 'robot', brand: 'RoboCo', amountCents: 1000 });
    await confirmPayment('mock', 'evt_claim', payment.providerReference, db);

    await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 5000 });

    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(after.valueCents).toBe(1000);
  });

  it('a failed boost payment leaves the value untouched', async () => {
    const { word, owner, payment } = await seedPendingPayment({ word: 'robot', brand: 'RoboCo', amountCents: 1000 });
    await confirmPayment('mock', 'evt_claim', payment.providerReference, db);

    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 5000 });
    expect(await failPayment('mock', 'evt_fail', boost.providerReference, db)).toBe('failed');

    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(after.valueCents).toBe(1000);
    const paid = await db.payment.findUniqueOrThrow({ where: { id: boost.id } });
    expect(paid.status).toBe('FAILED');
  });

  it('loses and refunds when another brand already took the word over', async () => {
    const first = await seedPendingPayment({ word: 'cloud', brand: 'CloudCo', amountCents: 1000 });
    await confirmPayment('mock', 'evt_claim', first.payment.providerReference, db);

    // CloudCo starts a boost, but before it confirms, a different brand takes the word over.
    const boost = await seedBoostPayment({ wordId: first.word.id, ownerId: first.owner.id, amountCents: 500 });

    const second = await seedPendingPayment({ word: 'cloud', brand: 'StormCo', amountCents: 2000 });
    await confirmPayment('mock', 'evt_takeover', second.payment.providerReference, db);

    const result = await confirmPayment('mock', 'evt_boost', boost.providerReference, db);
    expect(result.outcome).toBe('lost');

    const word = await db.word.findUniqueOrThrow({
      where: { id: first.word.id },
      include: { currentOwnership: { include: { owner: true } } },
    });
    expect(word.currentOwnership?.owner.name).toBe('StormCo');
    expect(word.valueCents).toBe(2000);

    const paid = await db.payment.findUniqueOrThrow({ where: { id: boost.id } });
    expect(paid.status).toBe('REFUND_PENDING');
    expect(paid.failureReason).toMatch(/took over/i);
  });

  it('cannot be applied twice by a redelivered webhook event', async () => {
    const { word, owner, payment } = await seedPendingPayment({ word: 'ai', brand: 'AcmeAI', amountCents: 5000 });
    await confirmPayment('mock', 'evt_claim', payment.providerReference, db);

    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 1000 });

    const first = await confirmPayment('mock', 'evt_dup', boost.providerReference, db);
    const second = await confirmPayment('mock', 'evt_dup', boost.providerReference, db);

    expect(first.outcome).toBe('boosted');
    expect(second.outcome).toBe('duplicate');

    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(after.valueCents).toBe(6000);
  });

  it('stays transaction-safe when a boost and a competing takeover race concurrently', async () => {
    const { word, owner, payment } = await seedPendingPayment({ word: 'race', brand: 'A', amountCents: 1000 });
    await confirmPayment('mock', 'evt_claim', payment.providerReference, db);

    // Boost target (1500) beats the takeover bid (1400): whichever transaction commits first
    // determines which of the two can possibly still win, so exactly one succeeds either way.
    const boost = await seedBoostPayment({ wordId: word.id, ownerId: owner.id, amountCents: 500 });
    const takeover = await seedPendingPayment({ word: 'race', brand: 'B', amountCents: 1400 });

    const [boostResult, takeoverResult] = await Promise.all([
      confirmPayment('mock', 'evt_boost', boost.providerReference, db),
      confirmPayment('mock', 'evt_takeover', takeover.payment.providerReference, db),
    ]);

    const outcomes = [boostResult.outcome, takeoverResult.outcome];
    expect(outcomes.filter((o) => o === 'lost')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'boosted' || o === 'won')).toHaveLength(1);

    const after = await db.word.findUniqueOrThrow({
      where: { id: word.id },
      include: { currentOwnership: true },
    });
    expect(after.currentOwnership).not.toBeNull();
    // Ranking, ownership and payment state never disagree, whichever order the race resolved in.
    expect(after.valueCents).toBe(after.currentOwnership!.amountCents);
    expect(await db.ownership.count({ where: { wordId: word.id, endedAt: null } })).toBe(1);

    const payments = await db.payment.findMany({ where: { wordId: word.id } });
    expect(payments.every((p) => p.status === 'CONFIRMED' || p.status === 'REFUND_PENDING')).toBe(true);
  });
});
