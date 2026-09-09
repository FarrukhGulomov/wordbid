import crypto from 'node:crypto';
import { cache } from 'react';
import { prisma } from './db';

/**
 * Public "attention proof": real, honestly-defined visitor and engagement numbers.
 *
 * Rules that keep this trustworthy:
 *   - A row is only ever created from the client heartbeat (/api/visit), which requires a real
 *     browser to run JavaScript — most bots and prefetchers never do that — AND passes a
 *     User-Agent check (looksLikeBot). No number here is fabricated or estimated.
 *   - "Online" = a distinct visitor whose last heartbeat was within the last 5 minutes.
 *   - "Visitors" = distinct long-lived cookies ever seen. Not page views, not clicks.
 */

export const VISITOR_COOKIE = 'wb_visitor';
/** Cookie lifetime: long enough that a returning visitor is still recognised as the same one. */
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function newVisitorId(): string {
  return crypto.randomUUID();
}

/** Truncates a timestamp to the top of its UTC hour — the bucket key for the 24h chart. */
export function hourBucketOf(date: Date): Date {
  const ms = date.getTime();
  return new Date(ms - (ms % (60 * 60 * 1000)));
}

/**
 * Distinct visitors active in the last 5 minutes.
 *
 * CGPT-F08: the root layout (header) and /stats each called this independently, moments apart in
 * the same request — two real queries against a number that changes by the second, so the two
 * counts could (and, per the audit, did) legitimately disagree on one screen. React's `cache()`
 * memoizes this per SERVER request: every caller within the same render gets the exact same
 * value, computed once, rather than each getting its own true-at-that-instant snapshot.
 */
export const getOnlineCount = cache(async (): Promise<number> => {
  return prisma.visitor.count({
    where: { lastSeenAt: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) } },
  });
});

/** Distinct real visitors ever seen. Memoized per request — see getOnlineCount. */
export const getTotalVisitors = cache(async (): Promise<number> => {
  return prisma.visitor.count();
});

export type HourlyVisitors = { hour: Date; count: number };

/**
 * Visitor counts for each of the last `hours` hours, oldest first. Hours with no activity are
 * included as 0 so the chart has no gaps.
 */
export async function getHourlyVisitors(hours = 24): Promise<HourlyVisitors[]> {
  const now = hourBucketOf(new Date());
  const since = new Date(now.getTime() - (hours - 1) * 60 * 60 * 1000);

  const rows = await prisma.visitorHourly.groupBy({
    by: ['hourBucket'],
    where: { hourBucket: { gte: since } },
    _count: { _all: true },
  });
  const counts = new Map(rows.map((r) => [r.hourBucket.getTime(), r._count._all]));

  const buckets: HourlyVisitors[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
    buckets.push({ hour, count: counts.get(hour.getTime()) ?? 0 });
  }
  return buckets;
}

/**
 * Words ranked by lifetime clicks (Word.clickCount) — an aggregate "attention" figure across
 * every owner a word has ever had. Deliberately NOT Ownership.clickCount, which is scoped to
 * the current owner only and resets to 0 on takeover (see prisma/schema.prisma).
 */
export async function getMostClickedWords(limit = 5) {
  return prisma.word.findMany({
    where: { blocked: false, currentOwnershipId: { not: null }, clickCount: { gt: 0 } },
    orderBy: { clickCount: 'desc' },
    take: limit,
    include: { currentOwnership: { include: { owner: { select: { name: true } } } } },
  });
}

/** Records one heartbeat for a visitor: updates/creates the Visitor row and this hour's bucket. */
export async function recordHeartbeat(visitorId: string): Promise<void> {
  const now = new Date();
  const hourBucket = hourBucketOf(now);

  await prisma.$transaction([
    prisma.visitor.upsert({
      where: { id: visitorId },
      update: { lastSeenAt: now },
      create: { id: visitorId, firstSeenAt: now, lastSeenAt: now },
    }),
    prisma.visitorHourly.upsert({
      where: { visitorId_hourBucket: { visitorId, hourBucket } },
      update: {},
      create: { visitorId, hourBucket },
    }),
  ]);
}
