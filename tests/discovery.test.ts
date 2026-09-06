import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { recordClick } from '@/lib/clicks';
import { recordImpressions } from '@/lib/ownership-stats';
import {
  isTrending,
  trendingScore,
  risingDelta,
  isRising,
  isHiddenGemEligible,
  hiddenGemScore,
  getTrendingWords,
  getRisingWords,
  getHiddenGems,
  getNewArrivals,
} from '@/lib/discovery';
import { db, resetDb, seedPendingPayment } from './helpers';

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

async function claim(word: string, brand: string, amountCents: number, eventId: string) {
  const seeded = await seedPendingPayment({ word, brand, amountCents });
  const result = await confirmPayment('mock', eventId, seeded.payment.providerReference, db);
  expect(result.outcome).toBe('won');
  const withOwnership = await db.word.findUniqueOrThrow({
    where: { id: seeded.word.id },
    include: { currentOwnership: true },
  });
  return { ...seeded, ownershipId: withOwnership.currentOwnership!.id };
}

/** Real, distinct-visitor clicks recorded today, via the actual tracked path. */
async function clickTimes(ownershipId: string, wordId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await recordClick({ ownershipId, wordId, ip: `10.9.${i}.1`, userAgent: CHROME });
  }
}

describe('attention engine — pure scoring', () => {
  it('trending requires a real minimum, not a single click', () => {
    expect(isTrending({ recentClicks: 0 })).toBe(false);
    expect(isTrending({ recentClicks: 1 })).toBe(false);
    expect(isTrending({ recentClicks: 3 })).toBe(true);
    expect(trendingScore({ recentClicks: 7 })).toBe(7);
  });

  it('rising requires a real, meaningful climb', () => {
    expect(risingDelta(5, 3)).toBe(2); // was #5, now #3
    expect(isRising(1)).toBe(false); // a 1-place wobble is not "rising"
    expect(isRising(2)).toBe(true);
    expect(isRising(-3)).toBe(false); // fell — never "rising"
  });

  it('hidden gem eligibility requires both distance from the top and a real sample size', () => {
    expect(isHiddenGemEligible({ rank: 1, recentImpressions: 1000 })).toBe(false); // already visible
    expect(isHiddenGemEligible({ rank: 3, recentImpressions: 1000 })).toBe(false);
    expect(isHiddenGemEligible({ rank: 4, recentImpressions: 5 })).toBe(false); // too few impressions
    expect(isHiddenGemEligible({ rank: 4, recentImpressions: 50 })).toBe(true);
  });

  it('hidden gem score cannot be raised by paying more — only by real engagement', () => {
    const cheap = hiddenGemScore({ recentClicks: 10, recentImpressions: 100, valueCents: 1000 });
    const expensive = hiddenGemScore({ recentClicks: 10, recentImpressions: 100, valueCents: 100_000 });
    // Same real engagement, more money spent — the score can only go down, never up.
    expect(expensive).toBeLessThan(cheap);
  });

  it('hidden gem score rewards real CTR, never impressions alone', () => {
    const lowCtr = hiddenGemScore({ recentClicks: 2, recentImpressions: 100, valueCents: 1000 });
    const highCtr = hiddenGemScore({ recentClicks: 20, recentImpressions: 100, valueCents: 1000 });
    expect(highCtr).toBeGreaterThan(lowCtr);
  });

  it('is 0, never NaN, with zero impressions', () => {
    expect(hiddenGemScore({ recentClicks: 0, recentImpressions: 0, valueCents: 1000 })).toBe(0);
  });
});

describe('getTrendingWords', () => {
  it('surfaces a word with real recent clicks, and excludes one below the threshold', async () => {
    const busy = await claim('ai', 'AcmeAI', 5000, 'e1');
    const quiet = await claim('coding', 'DevX', 1000, 'e2');
    await clickTimes(busy.ownershipId, busy.word.id, 5);
    await clickTimes(quiet.ownershipId, quiet.word.id, 1);

    const trending = await getTrendingWords();
    expect(trending.map((r) => r.normalized)).toEqual(['ai']);
    expect(trending[0]!.highlight).toMatch(/5 clicks this week/);
  });

  it('never counts a previous owner\'s clicks toward the new owner\'s trending status', async () => {
    const first = await claim('coding', 'DevX', 1000, 'e1');
    await clickTimes(first.ownershipId, first.word.id, 10); // DevX earns plenty of clicks

    // CodeAI takes over — a fresh ownership period, zero clicks of its own yet.
    const takeover = await seedPendingPayment({ word: 'coding', brand: 'CodeAI', amountCents: 2000 });
    await confirmPayment('mock', 'e2', takeover.payment.providerReference, db);

    const trending = await getTrendingWords();
    expect(trending.map((r) => r.normalized)).not.toContain('coding');
  });

  it('is empty, not fabricated, when nothing has real recent engagement', async () => {
    await claim('ai', 'AcmeAI', 5000, 'e1');
    expect(await getTrendingWords()).toEqual([]);
  });
});

describe('getRisingWords', () => {
  it('surfaces a word that really climbed since a real prior observation', async () => {
    const { word } = await claim('coding', 'DevX', 1000, 'e1');
    await claim('ai', 'AcmeAI', 5000, 'e2'); // coding starts at rank 2

    // A real observation from 5 days ago, at rank 3 (some other word existed above it too).
    await db.rankSnapshot.create({
      data: { wordId: word.id, day: new Date(Date.now() - 5 * 86_400_000), rank: 3, valueCents: 1000 },
    });

    // coding takes over #1 today.
    const bigger = await seedPendingPayment({ word: 'coding', brand: 'DevX2', amountCents: 6000 });
    await confirmPayment('mock', 'e3', bigger.payment.providerReference, db);

    const rising = await getRisingWords();
    expect(rising.map((r) => r.normalized)).toEqual(['coding']);
    expect(rising[0]!.highlight).toMatch(/Up 2 this week/);
  });

  it('never fabricates a rise for a word with no real prior observation', async () => {
    await claim('ai', 'AcmeAI', 5000, 'e1');
    expect(await getRisingWords()).toEqual([]);
  });

  it('ignores a snapshot that is too recent to count as a real trend (< 3 days old)', async () => {
    const { word } = await claim('coding', 'DevX', 1000, 'e1');
    await db.rankSnapshot.create({
      data: { wordId: word.id, day: new Date(Date.now() - 1 * 86_400_000), rank: 5, valueCents: 1000 },
    });
    const bigger = await seedPendingPayment({ word: 'coding', brand: 'DevX2', amountCents: 6000 });
    await confirmPayment('mock', 'e2', bigger.payment.providerReference, db);

    expect(await getRisingWords()).toEqual([]);
  });

  it('does not call a small wobble "rising"', async () => {
    const { word } = await claim('coding', 'DevX', 5000, 'e1');
    await db.rankSnapshot.create({
      data: { wordId: word.id, day: new Date(Date.now() - 5 * 86_400_000), rank: 2, valueCents: 5000 },
    });
    // A boost that only moves it one place — below the "rising" threshold.
    await claim('ai', 'AcmeAI', 4000, 'e2'); // coding stays #1, ai is #2 — no real climb for coding

    expect(await getRisingWords()).toEqual([]);
  });
});

describe('getHiddenGems', () => {
  it('surfaces a lower-ranked word with real, strong engagement', async () => {
    // Three filler words above it in value — "coding" must rank outside the top 3 to even be
    // eligible; being #1, #2 or #3 means it's already visible, not "hidden".
    await claim('a', 'A', 100_000, 'f1');
    await claim('b', 'B', 90_000, 'f2');
    await claim('c', 'C', 80_000, 'f3');
    const gem = await claim('coding', 'DevX', 1000, 'e2'); // cheap, rank 4

    await clickTimes(gem.ownershipId, gem.word.id, 15);
    for (let i = 0; i < 30; i++) await recordImpressions(['coding']);

    const gems = await getHiddenGems();
    expect(gems.map((r) => r.normalized)).toEqual(['coding']);
    expect(gems[0]!.highlight).toMatch(/engagement/i);
  });

  it('never lets the #1 (or top 3) word qualify — it is already visible by definition', async () => {
    const top = await claim('ai', 'AcmeAI', 1000, 'e1');
    await clickTimes(top.ownershipId, top.word.id, 20);
    for (let i = 0; i < 30; i++) await recordImpressions(['ai']);

    expect(await getHiddenGems()).toEqual([]);
  });

  it('requires a real sample size — a handful of impressions is not enough', async () => {
    await claim('ai', 'AcmeAI', 100_000, 'e1');
    const small = await claim('coding', 'DevX', 1000, 'e2');
    await clickTimes(small.ownershipId, small.word.id, 3);
    for (let i = 0; i < 3; i++) await recordImpressions(['coding']);

    expect(await getHiddenGems()).toEqual([]);
  });

  it('cannot be bought — a costlier word with identical real engagement never outranks a cheaper one', async () => {
    await claim('a', 'A', 100_000, 'f1');
    await claim('b', 'B', 90_000, 'f2');
    await claim('c', 'C', 80_000, 'f3');
    const cheap = await claim('coding', 'DevX', 1000, 'e2'); // rank 4
    const pricier = await claim('design', 'Pixelry', 5000, 'e3'); // rank 5, still outside top 3

    // Identical real engagement for both — the only difference is how much each paid.
    await clickTimes(cheap.ownershipId, cheap.word.id, 15);
    await clickTimes(pricier.ownershipId, pricier.word.id, 15);
    for (let i = 0; i < 30; i++) {
      await recordImpressions(['coding']);
      await recordImpressions(['design']);
    }

    const gems = await getHiddenGems();
    const cheapIndex = gems.findIndex((r) => r.normalized === 'coding');
    const pricierIndex = gems.findIndex((r) => r.normalized === 'design');
    expect(cheapIndex).toBeGreaterThanOrEqual(0);
    expect(pricierIndex).toBeGreaterThanOrEqual(0);
    // Same earned engagement, more money spent — the cheaper word ranks higher, never the paid one.
    expect(cheapIndex).toBeLessThan(pricierIndex);
  });
});

describe('getNewArrivals', () => {
  it('orders by recency, never by value', async () => {
    await claim('ai', 'AcmeAI', 100_000, 'e1');
    await new Promise((r) => setTimeout(r, 10));
    await claim('coding', 'DevX', 1000, 'e2'); // claimed later, worth far less

    const recent = await getNewArrivals();
    expect(recent.map((r) => r.normalized)).toEqual(['coding', 'ai']);
    expect(recent[0]!.highlight).toMatch(/Claimed/);
  });
});
