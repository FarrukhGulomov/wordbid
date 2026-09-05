import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
  getOnlineCount,
  getTotalVisitors,
  getHourlyVisitors,
  getMostClickedWords,
  recordHeartbeat,
  hourBucketOf,
  newVisitorId,
  ONLINE_WINDOW_MS,
} from '@/lib/attention';
import { confirmPayment } from '@/lib/ownership';
import { recordClick } from '@/lib/clicks';
import { db, resetDb, seedPendingPayment } from './helpers';

beforeEach(resetDb);
afterAll(async () => {
  await db.$disconnect();
});

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36';

describe('hourBucketOf', () => {
  it('truncates to the top of the hour', () => {
    const d = new Date('2026-01-01T14:37:22.123Z');
    expect(hourBucketOf(d).toISOString()).toBe('2026-01-01T14:00:00.000Z');
  });

  it('is stable for any timestamp within the same hour', () => {
    const a = hourBucketOf(new Date('2026-01-01T14:00:00.000Z'));
    const b = hourBucketOf(new Date('2026-01-01T14:59:59.999Z'));
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe('recordHeartbeat', () => {
  it('creates a visitor on first heartbeat', async () => {
    const id = newVisitorId();
    await recordHeartbeat(id);

    const visitor = await db.visitor.findUniqueOrThrow({ where: { id } });
    expect(visitor.firstSeenAt).toEqual(visitor.lastSeenAt);
  });

  it('updates lastSeenAt on a repeat heartbeat without creating a second visitor', async () => {
    const id = newVisitorId();
    await recordHeartbeat(id);
    const first = await db.visitor.findUniqueOrThrow({ where: { id } });

    await new Promise((r) => setTimeout(r, 10));
    await recordHeartbeat(id);

    expect(await db.visitor.count()).toBe(1);
    const second = await db.visitor.findUniqueOrThrow({ where: { id } });
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
    expect(second.firstSeenAt.getTime()).toBe(first.firstSeenAt.getTime());
  });

  it('records exactly one hourly bucket row per visitor per hour, even with repeat heartbeats', async () => {
    const id = newVisitorId();
    await recordHeartbeat(id);
    await recordHeartbeat(id);
    await recordHeartbeat(id);

    expect(await db.visitorHourly.count({ where: { visitorId: id } })).toBe(1);
  });
});

describe('getOnlineCount', () => {
  it('counts only visitors active within the last 5 minutes', async () => {
    const recentId = newVisitorId();
    await recordHeartbeat(recentId);

    const staleId = newVisitorId();
    await db.visitor.create({
      data: {
        id: staleId,
        firstSeenAt: new Date(Date.now() - ONLINE_WINDOW_MS - 60_000),
        lastSeenAt: new Date(Date.now() - ONLINE_WINDOW_MS - 60_000),
      },
    });

    expect(await getOnlineCount()).toBe(1);
  });

  it('is 0 with no visitors', async () => {
    expect(await getOnlineCount()).toBe(0);
  });
});

describe('getTotalVisitors', () => {
  it('counts distinct visitors, not heartbeats', async () => {
    const a = newVisitorId();
    const b = newVisitorId();
    await recordHeartbeat(a);
    await recordHeartbeat(a);
    await recordHeartbeat(b);

    expect(await getTotalVisitors()).toBe(2);
  });
});

describe('getHourlyVisitors', () => {
  it('returns 24 buckets, oldest first, ending at the current hour', async () => {
    const buckets = await getHourlyVisitors(24);
    expect(buckets).toHaveLength(24);
    expect(buckets[23]!.hour.getTime()).toBe(hourBucketOf(new Date()).getTime());
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]!.hour.getTime()).toBeGreaterThan(buckets[i - 1]!.hour.getTime());
    }
  });

  it('fills hours with no activity as 0', async () => {
    const buckets = await getHourlyVisitors(24);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('counts a visitor active this hour in the current bucket', async () => {
    await recordHeartbeat(newVisitorId());
    const buckets = await getHourlyVisitors(24);
    expect(buckets[buckets.length - 1]!.count).toBe(1);
  });

  it('does not double-count a visitor active twice in the same hour', async () => {
    const id = newVisitorId();
    await recordHeartbeat(id);
    await recordHeartbeat(id);
    const buckets = await getHourlyVisitors(24);
    expect(buckets[buckets.length - 1]!.count).toBe(1);
  });

  it('excludes activity older than the requested window', async () => {
    const oldId = newVisitorId();
    await db.visitor.create({
      data: { id: oldId, firstSeenAt: new Date(0), lastSeenAt: new Date(0) },
    });
    await db.visitorHourly.create({
      data: { visitorId: oldId, hourBucket: hourBucketOf(new Date(0)) },
    });

    const buckets = await getHourlyVisitors(24);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(0);
  });
});

describe('getMostClickedWords', () => {
  it('ranks by lifetime Word.clickCount, which survives a takeover', async () => {
    // Reproduces the same scenario as the click-attribution regression, but for the
    // aggregate/lifetime figure, which — unlike the per-owner count — must NOT reset.
    const first = await seedPendingPayment({ word: 'education', brand: 'BilimON', amountCents: 1000 });
    await confirmPayment('mock', 'e1', first.payment.providerReference, db);
    const firstOwnership = (
      await db.word.findUniqueOrThrow({ where: { id: first.word.id }, include: { currentOwnership: true } })
    ).currentOwnership!.id;
    await recordClick({ ownershipId: firstOwnership, wordId: first.word.id, ip: '1.1.1.1', userAgent: CHROME });
    await recordClick({ ownershipId: firstOwnership, wordId: first.word.id, ip: '2.2.2.2', userAgent: CHROME });

    const second = await seedPendingPayment({ word: 'education', brand: 'kursi24', amountCents: 2000 });
    await confirmPayment('mock', 'e2', second.payment.providerReference, db);
    const secondOwnership = (
      await db.word.findUniqueOrThrow({ where: { id: first.word.id }, include: { currentOwnership: true } })
    ).currentOwnership!.id;
    await recordClick({ ownershipId: secondOwnership, wordId: first.word.id, ip: '3.3.3.3', userAgent: CHROME });

    const ranked = await getMostClickedWords();
    expect(ranked).toHaveLength(1);
    // Lifetime total: 2 (BilimON) + 1 (kursi24) = 3 — never reset by the takeover.
    expect(ranked[0]).toMatchObject({ normalized: 'education', clickCount: 3 });
    // But it currently displays the NEW owner, per the leaderboard rule elsewhere.
    expect(ranked[0]!.currentOwnership!.owner.name).toBe('kursi24');
  });

  it('excludes words with no clicks yet', async () => {
    const seeded = await seedPendingPayment({ word: 'ai', brand: 'AcmeAI', amountCents: 1000 });
    await confirmPayment('mock', 'e1', seeded.payment.providerReference, db);

    expect(await getMostClickedWords()).toEqual([]);
  });
});
