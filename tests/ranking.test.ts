import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { getLeaderboard, getRank } from '@/lib/queries';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

/** Confirms a claim and returns the word row. */
async function claim(word: string, brand: string, amountCents: number, eventId: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents });
  const result = await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  expect(result.outcome).toBe('won');
  return seeded.word;
}

describe('global leaderboard', () => {
  it('orders by current value descending', async () => {
    await claim('coding', 'DevX', 285000, 'e1');
    await claim('ai', 'AcmeAI', 482000, 'e2');
    await claim('video', 'VideoX', 321000, 'e3');

    const board = await getLeaderboard();
    expect(board.map((r) => r.normalized)).toEqual(['ai', 'video', 'coding']);
    expect(board.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(board[0]!.ownerName).toBe('AcmeAI');
    expect(board[0]!.valueCents).toBe(482000);
  });

  it('breaks ties by earlier confirmed ownership', async () => {
    const first = await claim('alpha', 'First', 5000, 'e1');
    await new Promise((r) => setTimeout(r, 10));
    const second = await claim('beta', 'Second', 5000, 'e2');

    const board = await getLeaderboard();
    expect(board.map((r) => r.normalized)).toEqual(['alpha', 'beta']);
    expect(await getRank(first.id)).toBe(1);
    expect(await getRank(second.id)).toBe(2);
  });

  it('excludes words nobody currently owns', async () => {
    // A pending payment must not put a word on the board.
    await seedPendingPayment({ word: 'unpaid', brand: 'Ghost', amountCents: 999999 });
    await claim('paid', 'Real', 1000, 'e1');

    const board = await getLeaderboard();
    expect(board.map((r) => r.normalized)).toEqual(['paid']);
  });

  it('excludes blocked words', async () => {
    const word = await claim('spam', 'Spammer', 900000, 'e1');
    await claim('clean', 'Good', 1000, 'e2');
    await db.word.update({ where: { id: word.id }, data: { blocked: true } });

    const board = await getLeaderboard();
    expect(board.map((r) => r.normalized)).toEqual(['clean']);
    expect(await getRank(word.id)).toBeNull();
  });

  it('re-ranks immediately after a takeover', async () => {
    await claim('ai', 'AcmeAI', 100000, 'e1');
    const coding = await claim('coding', 'DevX', 50000, 'e2');
    expect(await getRank(coding.id)).toBe(2);

    await claim('coding', 'CodeAI', 200000, 'e3');
    expect(await getRank(coding.id)).toBe(1);

    const board = await getLeaderboard();
    expect(board[0]).toMatchObject({ normalized: 'coding', ownerName: 'CodeAI', valueCents: 200000 });
  });

  it('publishes the price needed to take each row', async () => {
    await claim('ai', 'AcmeAI', 100000, 'e1');
    const board = await getLeaderboard();
    expect(board[0]!.minimumBidCents).toBe(105000);
  });

  it('exposes each row\'s authoritative BidRank score, matching the leaderboard order', async () => {
    await claim('coding', 'DevX', 100000, 'e1');
    await claim('ai', 'AcmeAI', 482000, 'e2');

    const board = await getLeaderboard();
    expect(board[0]!.bidRankScore).toBe(482000);
    expect(board[1]!.bidRankScore).toBe(100000);
    expect(board[0]!.bidRankScore).toBeGreaterThan(board[1]!.bidRankScore);
  });
});
