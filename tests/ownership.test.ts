import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment, failPayment } from '@/lib/ownership';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

describe('confirmPayment — first claim', () => {
  it('grants ownership, sets the value and writes an activity entry', async () => {
    const { word, owner, payment } = await seedPendingPayment({
      word: 'coding',
      brand: 'DevX',
      amountCents: 1000,
    });

    const result = await confirmPayment('mock', 'evt_1', payment.providerReference, db);
    expect(result.outcome).toBe('won');

    const after = await db.word.findUniqueOrThrow({
      where: { id: word.id },
      include: { currentOwnership: true },
    });
    expect(after.valueCents).toBe(1000);
    expect(after.currentOwnership?.ownerId).toBe(owner.id);
    expect(after.ownedSince).not.toBeNull();

    const paid = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.status).toBe('CONFIRMED');
    expect(paid.confirmedAt).not.toBeNull();

    const activity = await db.activity.findFirstOrThrow({ where: { wordId: word.id } });
    expect(activity.type).toBe('CLAIMED');
    expect(activity.amountCents).toBe(1000);
    expect(activity.previousOwnerName).toBeNull();
  });
});

describe('confirmPayment — takeover', () => {
  it('ends the previous ownership, keeps it in history and records a TAKEOVER', async () => {
    const first = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 1000 });
    await confirmPayment('mock', 'evt_1', first.payment.providerReference, db);

    const second = await seedPendingPayment({ word: 'coding', brand: 'CodeAI', amountCents: 1050 });
    const result = await confirmPayment('mock', 'evt_2', second.payment.providerReference, db);
    expect(result.outcome).toBe('won');

    const word = await db.word.findUniqueOrThrow({
      where: { normalized: 'coding' },
      include: { currentOwnership: { include: { owner: true } } },
    });
    expect(word.valueCents).toBe(1050);
    expect(word.currentOwnership?.owner.name).toBe('CodeAI');

    // History is preserved, and the old period is closed.
    const history = await db.ownership.findMany({
      where: { wordId: word.id },
      orderBy: { startedAt: 'asc' },
      include: { owner: true },
    });
    expect(history).toHaveLength(2);
    expect(history[0]!.owner.name).toBe('DevX');
    expect(history[0]!.endedAt).not.toBeNull();
    expect(history[1]!.endedAt).toBeNull();

    const activity = await db.activity.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(activity.type).toBe('TAKEOVER');
    expect(activity.previousOwnerName).toBe('DevX');
  });
});

describe('confirmPayment — idempotency', () => {
  it('applies a redelivered event exactly once', async () => {
    const { word, payment } = await seedPendingPayment({
      word: 'ai',
      brand: 'AcmeAI',
      amountCents: 5000,
    });

    const first = await confirmPayment('mock', 'evt_dup', payment.providerReference, db);
    const second = await confirmPayment('mock', 'evt_dup', payment.providerReference, db);
    const third = await confirmPayment('mock', 'evt_dup', payment.providerReference, db);

    expect(first.outcome).toBe('won');
    expect(second.outcome).toBe('duplicate');
    expect(third.outcome).toBe('duplicate');

    expect(await db.ownership.count({ where: { wordId: word.id } })).toBe(1);
    expect(await db.activity.count({ where: { wordId: word.id } })).toBe(1);
    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(after.valueCents).toBe(5000);
  });

  it('never grants a second ownership for the same payment, even under a new event id', async () => {
    const { word, payment } = await seedPendingPayment({
      word: 'video',
      brand: 'VideoX',
      amountCents: 3000,
    });

    expect((await confirmPayment('mock', 'evt_a', payment.providerReference, db)).outcome).toBe('won');
    const again = await confirmPayment('mock', 'evt_b', payment.providerReference, db);

    expect(again.outcome).toBe('already_confirmed');
    expect(await db.ownership.count({ where: { wordId: word.id } })).toBe(1);
  });

  it('runs concurrent redeliveries of the same event without double-applying', async () => {
    const { word, payment } = await seedPendingPayment({
      word: 'cloud',
      brand: 'CloudCo',
      amountCents: 2500,
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => confirmPayment('mock', 'evt_race', payment.providerReference, db)),
    );

    expect(results.filter((r) => r.outcome === 'won')).toHaveLength(1);
    expect(await db.ownership.count({ where: { wordId: word.id } })).toBe(1);
    expect(await db.word.findUniqueOrThrow({ where: { id: word.id } })).toMatchObject({
      valueCents: 2500,
    });
  });
});

describe('confirmPayment — losing the race', () => {
  it('does not grant ownership and flags the payment for refund', async () => {
    const winner = await seedPendingPayment({ word: 'coding', brand: 'DevX', amountCents: 2000 });
    // Checkout started while the word was cheaper, so this amount no longer beats the value.
    const loser = await seedPendingPayment({ word: 'coding', brand: 'SlowCo', amountCents: 1500 });

    await confirmPayment('mock', 'evt_win', winner.payment.providerReference, db);
    const result = await confirmPayment('mock', 'evt_lose', loser.payment.providerReference, db);

    expect(result.outcome).toBe('lost');

    const word = await db.word.findUniqueOrThrow({
      where: { normalized: 'coding' },
      include: { currentOwnership: { include: { owner: true } } },
    });
    expect(word.valueCents).toBe(2000);
    expect(word.currentOwnership?.owner.name).toBe('DevX');

    const paid = await db.payment.findUniqueOrThrow({ where: { id: loser.payment.id } });
    expect(paid.status).toBe('REFUND_PENDING');
    expect(paid.failureReason).toMatch(/took this word/i);
    expect(await db.ownership.count({ where: { wordId: word.id } })).toBe(1);
  });

  it('treats an equal bid as a loss — ties never change the crown', async () => {
    const first = await seedPendingPayment({ word: 'ai', brand: 'First', amountCents: 5000 });
    const second = await seedPendingPayment({ word: 'ai', brand: 'Second', amountCents: 5000 });

    await confirmPayment('mock', 'e1', first.payment.providerReference, db);
    const result = await confirmPayment('mock', 'e2', second.payment.providerReference, db);

    expect(result.outcome).toBe('lost');
    const word = await db.word.findUniqueOrThrow({
      where: { normalized: 'ai' },
      include: { currentOwnership: { include: { owner: true } } },
    });
    expect(word.currentOwnership?.owner.name).toBe('First');
  });

  it('serialises two simultaneous takeovers so exactly one wins', async () => {
    const a = await seedPendingPayment({ word: 'race', brand: 'A', amountCents: 4000 });
    const b = await seedPendingPayment({ word: 'race', brand: 'B', amountCents: 4000 });

    const [ra, rb] = await Promise.all([
      confirmPayment('mock', 'evt_a', a.payment.providerReference, db),
      confirmPayment('mock', 'evt_b', b.payment.providerReference, db),
    ]);

    const outcomes = [ra.outcome, rb.outcome].sort();
    expect(outcomes).toEqual(['lost', 'won']);
    expect(await db.ownership.count({ where: { word: { normalized: 'race' } } })).toBe(1);
  });

  it('refuses to grant a blocked word and flags the payment for refund', async () => {
    const { word, payment } = await seedPendingPayment({
      word: 'banned',
      brand: 'Nope',
      amountCents: 9000,
    });
    await db.word.update({ where: { id: word.id }, data: { blocked: true } });

    const result = await confirmPayment('mock', 'evt_blocked', payment.providerReference, db);
    expect(result.outcome).toBe('lost');
    expect(await db.ownership.count()).toBe(0);
    const after = await db.word.findUniqueOrThrow({ where: { id: word.id } });
    expect(after.valueCents).toBe(0);
    expect(after.currentOwnershipId).toBeNull();
  });
});

describe('confirmPayment — unknown reference', () => {
  it('reports an unknown payment without changing anything', async () => {
    const result = await confirmPayment('mock', 'evt_x', 'ref_that_does_not_exist', db);
    expect(result.outcome).toBe('unknown_payment');
    expect(await db.ownership.count()).toBe(0);
  });
});

describe('failPayment', () => {
  it('fails a pending payment and leaves ranking untouched', async () => {
    const { word, payment } = await seedPendingPayment({
      word: 'robot',
      brand: 'RoboCo',
      amountCents: 1000,
    });

    expect(await failPayment('mock', 'evt_fail', payment.providerReference, db)).toBe('failed');

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('FAILED');
    expect((await db.word.findUniqueOrThrow({ where: { id: word.id } })).valueCents).toBe(0);
  });

  it('never downgrades a payment that already won the word', async () => {
    const { payment } = await seedPendingPayment({ word: 'ai', brand: 'AcmeAI', amountCents: 1000 });
    await confirmPayment('mock', 'evt_ok', payment.providerReference, db);

    expect(await failPayment('mock', 'evt_late_fail', payment.providerReference, db)).toBe('ignored');
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('CONFIRMED');
  });

  it('ignores a redelivered failure event', async () => {
    const { payment } = await seedPendingPayment({ word: 'x1', brand: 'X', amountCents: 1000 });
    await failPayment('mock', 'evt_f', payment.providerReference, db);
    expect(await failPayment('mock', 'evt_f', payment.providerReference, db)).toBe('duplicate');
  });
});
