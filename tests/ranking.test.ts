import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { getLeaderboard, getRank, getProjectedRank, getWordByNormalized, countOwnedWords } from '@/lib/queries';
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

  // F07: a word's own `blocked` flag can drift from its owner's — e.g. an admin unblocking one
  // word of a suspended brand's several without noticing the brand itself is still blocked (see
  // the guard this same finding adds in src/app/admin/page.tsx's unblock_word). The public
  // surfaces must never trust word.blocked alone for that.
  it('excludes a word whose owner is blocked, even if the word itself is not', async () => {
    const word = await claim('spam', 'Spammer', 900000, 'e1');
    await claim('clean', 'Good', 1000, 'e2');
    // word.blocked stays false — only the OWNER is blocked, simulating the exact drift F07
    // describes rather than the more obvious block_word path already covered above.
    const owner = await db.owner.findFirstOrThrow({ where: { name: 'Spammer' } });
    await db.owner.update({ where: { id: owner.id }, data: { blocked: true } });

    const board = await getLeaderboard();
    expect(board.map((r) => r.normalized)).toEqual(['clean']);
    expect(await getRank(word.id)).toBeNull();
    // Only 'clean' (1000) should count as real competition — the blocked owner's 900000 must not.
    expect(await getProjectedRank(2000)).toBe(1);
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

describe('getWordByNormalized — F07', () => {
  it('404s (returns null) for a word whose current owner is blocked, even if the word is not', async () => {
    const word = await claim('spam', 'Spammer', 900000, 'e1');
    const owner = await db.owner.findFirstOrThrow({ where: { name: 'Spammer' } });
    await db.owner.update({ where: { id: owner.id }, data: { blocked: true } });

    expect(await getWordByNormalized(word.normalized)).toBeNull();
  });
});

// F15: the homepage Top view pages through getLeaderboard(limit, skip) using countOwnedWords()
// for the total — this proves that pairing actually produces a correct, gap-free second page.
describe('getLeaderboard pagination — F15', () => {
  it('a second page (skip) picks up exactly where the first page left off, with correct ranks', async () => {
    for (let i = 0; i < 5; i++) {
      await claim(`word${i}`, `Brand${i}`, 1000 + i * 10, `e${i}`);
    }
    expect(await countOwnedWords()).toBe(5);

    const page1 = await getLeaderboard(2, 0);
    const page2 = await getLeaderboard(2, 2);
    const page3 = await getLeaderboard(2, 4);

    expect(page1.map((r) => r.rank)).toEqual([1, 2]);
    expect(page2.map((r) => r.rank)).toEqual([3, 4]);
    expect(page3.map((r) => r.rank)).toEqual([5]);

    const allNormalized = [...page1, ...page2, ...page3].map((r) => r.normalized);
    expect(new Set(allNormalized).size).toBe(5); // no duplicates, no gaps
  });
});

describe('getProjectedRank', () => {
  it('is #1 on an empty board, for any amount', async () => {
    expect(await getProjectedRank(100)).toBe(1);
  });

  it('slots a hypothetical amount into its honest position among real owned words', async () => {
    await claim('ai', 'AcmeAI', 482000, 'e1');
    await claim('video', 'VideoX', 321000, 'e2');
    await claim('coding', 'DevX', 285000, 'e3');

    expect(await getProjectedRank(500000)).toBe(1); // above everyone
    expect(await getProjectedRank(300000)).toBe(3); // behind ai and video, ahead of coding
    expect(await getProjectedRank(1)).toBe(4); // below everyone
  });

  it('ranks behind a REAL word already at the exact same value — nothing confirmed beats a real bid', async () => {
    await claim('ai', 'AcmeAI', 100000, 'e1');
    expect(await getProjectedRank(100000)).toBe(2);
  });

  it('excludes the word being claimed itself, so retaking your own word is not double-counted', async () => {
    const word = await claim('coding', 'DevX', 100000, 'e1');
    await claim('ai', 'AcmeAI', 200000, 'e2');

    // Without excluding "coding", its own current 100000 would count against a hypothetical
    // 100000 bid too, even though that exact value is about to be replaced by this payment.
    expect(await getProjectedRank(100000, word.id)).toBe(2);
    expect(await getProjectedRank(100000)).toBe(3);
  });

  it('never counts a blocked word as competition', async () => {
    const word = await claim('spam', 'Spammer', 900000, 'e1');
    await db.word.update({ where: { id: word.id }, data: { blocked: true } });

    expect(await getProjectedRank(100)).toBe(1);
  });
});
