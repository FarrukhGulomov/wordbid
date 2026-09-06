import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { confirmPayment } from '@/lib/ownership';
import { recordClick } from '@/lib/clicks';
import { getWordByNormalized } from '@/lib/queries';
import {
  recordImpressions,
  recordDailyClick,
  getOwnershipPerformance,
  calculateCtr,
  calculateCostPerClickCents,
  dayBucketOf,
} from '@/lib/ownership-stats';
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

describe('calculateCtr', () => {
  it('is unique clicks over impressions, as a percentage', () => {
    expect(calculateCtr(37, 1240)).toBeCloseTo(2.983, 2);
    expect(calculateCtr(1, 2)).toBe(50);
  });

  it('is 0 with 0 impressions — never NaN or Infinity', () => {
    expect(calculateCtr(0, 0)).toBe(0);
    expect(calculateCtr(5, 0)).toBe(0);
    expect(Number.isFinite(calculateCtr(0, 0))).toBe(true);
  });
});

describe('calculateCostPerClickCents', () => {
  it('is spend over valid clicks', () => {
    expect(calculateCostPerClickCents(10000, 40)).toBe(250); // $100 / 40 clicks = $2.50/click
  });

  it('is null with zero clicks — never Infinity or a fake number', () => {
    expect(calculateCostPerClickCents(10000, 0)).toBeNull();
  });
});

describe('dayBucketOf', () => {
  it('truncates to the UTC calendar day', () => {
    const d = new Date('2026-03-14T23:59:59.999Z');
    expect(dayBucketOf(d).toISOString()).toBe('2026-03-14T00:00:00.000Z');
  });
});

describe('the core regression: analytics belong to the ownership period, not the word', () => {
  it('BilimON clicks/impressions -> kursi24 takes over at 0 -> BilimON history intact -> BilimON reclaims at 0', async () => {
    // 1. BilimON owns EDUCATION, gets impressions and clicks.
    const bilimon = await claim('education', 'BilimON', 1000, 'e1');
    await recordImpressions(['education']);
    await recordImpressions(['education']);
    await recordClick({
      ownershipId: bilimon.ownershipId,
      wordId: bilimon.word.id,
      ip: '1.1.1.1',
      userAgent: CHROME,
    });

    let word = await getWordByNormalized('education');
    expect(word!.currentOwnership!.impressionCount).toBe(2);
    expect(word!.currentOwnership!.clickCount).toBe(1);

    // 2. kursi24 takes EDUCATION. The new ownership starts at zero on every dimension.
    const kursi24 = await claim('education', 'kursi24', 2000, 'e2');
    word = await getWordByNormalized('education');
    expect(word!.currentOwnership!.owner.name).toBe('kursi24');
    expect(word!.currentOwnership!.impressionCount).toBe(0);
    expect(word!.currentOwnership!.clickCount).toBe(0);

    // 3. kursi24 receives its own, separate analytics.
    await recordImpressions(['education']);
    await recordClick({
      ownershipId: kursi24.ownershipId,
      wordId: kursi24.word.id,
      ip: '2.2.2.2',
      userAgent: CHROME,
    });
    await recordClick({
      ownershipId: kursi24.ownershipId,
      wordId: kursi24.word.id,
      ip: '3.3.3.3',
      userAgent: CHROME,
    });

    word = await getWordByNormalized('education');
    expect(word!.currentOwnership!.impressionCount).toBe(1);
    expect(word!.currentOwnership!.clickCount).toBe(2);

    // 4. BilimON's historical ownership is untouched by any of kursi24's activity.
    const bilimonHistory = await db.ownership.findUniqueOrThrow({
      where: { id: bilimon.ownershipId },
    });
    expect(bilimonHistory.impressionCount).toBe(2);
    expect(bilimonHistory.clickCount).toBe(1);
    expect(bilimonHistory.endedAt).not.toBeNull();

    // 5. BilimON reclaims EDUCATION. This is a THIRD, brand-new Ownership row — not a reuse of
    // the first one — and it starts at zero exactly like kursi24's did.
    const reclaimed = await claim('education', 'BilimON', 3000, 'e3');
    expect(reclaimed.ownershipId).not.toBe(bilimon.ownershipId);

    word = await getWordByNormalized('education');
    expect(word!.currentOwnership!.owner.name).toBe('BilimON');
    expect(word!.currentOwnership!.impressionCount).toBe(0);
    expect(word!.currentOwnership!.clickCount).toBe(0);

    // 6. All three periods now exist in history, each keeping its own numbers.
    const allPeriods = await db.ownership.findMany({
      where: { wordId: bilimon.word.id },
      orderBy: { startedAt: 'asc' },
    });
    expect(allPeriods).toHaveLength(3);
    expect(allPeriods[0]).toMatchObject({ id: bilimon.ownershipId, impressionCount: 2, clickCount: 1 });
    expect(allPeriods[1]).toMatchObject({ id: kursi24.ownershipId, impressionCount: 1, clickCount: 2 });
    expect(allPeriods[2]).toMatchObject({ id: reclaimed.ownershipId, impressionCount: 0, clickCount: 0 });
  });
});

describe('recordImpressions', () => {
  it('increments impressionCount for every currently-owned word given', async () => {
    const a = await claim('ai', 'AcmeAI', 1000, 'e1');
    const b = await claim('coding', 'DevX', 1000, 'e2');

    await recordImpressions(['ai', 'coding']);

    expect((await db.ownership.findUniqueOrThrow({ where: { id: a.ownershipId } })).impressionCount).toBe(1);
    expect((await db.ownership.findUniqueOrThrow({ where: { id: b.ownershipId } })).impressionCount).toBe(1);
  });

  it('ignores unclaimed and unknown words without throwing', async () => {
    await expect(recordImpressions(['nobody-owns-this', 'also-nothing'])).resolves.toBeUndefined();
  });

  it('ignores blocked words', async () => {
    const a = await claim('spam', 'Spammer', 1000, 'e1');
    await db.word.update({ where: { id: a.word.id }, data: { blocked: true } });

    await recordImpressions(['spam']);
    expect((await db.ownership.findUniqueOrThrow({ where: { id: a.ownershipId } })).impressionCount).toBe(0);
  });

  it('deduplicates repeated words in one call to a single impression each', async () => {
    const a = await claim('ai', 'AcmeAI', 1000, 'e1');
    await recordImpressions(['ai', 'ai', 'ai']);
    expect((await db.ownership.findUniqueOrThrow({ where: { id: a.ownershipId } })).impressionCount).toBe(1);
  });

  it('records exactly one daily-bucket row per call, incrementing on repeat calls', async () => {
    const a = await claim('ai', 'AcmeAI', 1000, 'e1');
    await recordImpressions(['ai']);
    await recordImpressions(['ai']);

    const rows = await db.ownershipDailyStat.findMany({ where: { ownershipId: a.ownershipId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.impressions).toBe(2);
  });
});

describe('recordDailyClick', () => {
  it('creates and increments a single row for the current day', async () => {
    const a = await claim('ai', 'AcmeAI', 1000, 'e1');
    await recordDailyClick(a.ownershipId);
    await recordDailyClick(a.ownershipId);

    const rows = await db.ownershipDailyStat.findMany({ where: { ownershipId: a.ownershipId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clicks).toBe(2);
  });
});

describe('getOwnershipPerformance', () => {
  it('reports impressions, unique clicks (not raw clicks), and CTR', async () => {
    const a = await claim('ai', 'AcmeAI', 5000, 'e1');
    await recordImpressions(['ai']);
    await recordImpressions(['ai']);
    // Two clicks from the same visitor are one unique click, but both count toward validClicks
    // only if outside the dedupe window — here the second is a duplicate and won't be valid.
    await recordClick({ ownershipId: a.ownershipId, wordId: a.word.id, ip: '1.1.1.1', userAgent: CHROME });
    await recordClick({ ownershipId: a.ownershipId, wordId: a.word.id, ip: '2.2.2.2', userAgent: CHROME });

    const perf = await getOwnershipPerformance(a.ownershipId);
    expect(perf).toMatchObject({
      impressions: 2,
      validClicks: 2,
      uniqueClicks: 2,
      amountCents: 5000,
    });
    expect(perf!.ctr).toBeCloseTo(100, 5); // 2 unique clicks / 2 impressions
  });

  it('excludes invalid (bot) clicks from uniqueClicks', async () => {
    const a = await claim('ai', 'AcmeAI', 1000, 'e1');
    await recordClick({
      ownershipId: a.ownershipId,
      wordId: a.word.id,
      ip: '1.1.1.1',
      userAgent: 'Googlebot/2.1',
    });

    const perf = await getOwnershipPerformance(a.ownershipId);
    expect(perf!.uniqueClicks).toBe(0);
    expect(perf!.validClicks).toBe(0);
  });

  it('returns null for an unknown ownership id', async () => {
    expect(await getOwnershipPerformance('does-not-exist')).toBeNull();
  });

  it('reports top referrers by hostname, excluding invalid clicks', async () => {
    const a = await claim('ai', 'AcmeAI', 1000, 'e1');
    await recordClick({
      ownershipId: a.ownershipId,
      wordId: a.word.id,
      ip: '1.1.1.1',
      userAgent: CHROME,
      referrer: 'https://x.com/some/status',
    });
    await recordClick({
      ownershipId: a.ownershipId,
      wordId: a.word.id,
      ip: '2.2.2.2',
      userAgent: CHROME,
      referrer: 'https://x.com/other',
    });
    await recordClick({
      ownershipId: a.ownershipId,
      wordId: a.word.id,
      ip: '3.3.3.3',
      userAgent: CHROME,
    });

    const perf = await getOwnershipPerformance(a.ownershipId);
    const byHost = new Map(perf!.topReferrers.map((r) => [r.referrer, r.count]));
    expect(byHost.get('x.com')).toBe(2);
    expect(byHost.get('direct')).toBe(1);
  });

  it("today's and last-7-days click totals come from the daily rollup, scoped to this ownership", async () => {
    const a = await claim('ai', 'AcmeAI', 1000, 'e1');
    const b = await claim('coding', 'DevX', 1000, 'e2');
    await recordClick({ ownershipId: a.ownershipId, wordId: a.word.id, ip: '1.1.1.1', userAgent: CHROME });
    await recordClick({ ownershipId: a.ownershipId, wordId: a.word.id, ip: '2.2.2.2', userAgent: CHROME });
    // Different ownership entirely — must not leak into `a`'s totals.
    await recordClick({ ownershipId: b.ownershipId, wordId: b.word.id, ip: '3.3.3.3', userAgent: CHROME });

    const perf = await getOwnershipPerformance(a.ownershipId);
    expect(perf!.todayClicks).toBe(2);
    expect(perf!.last7DaysClicks).toBe(2);
  });
});
