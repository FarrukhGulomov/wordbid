import { prisma } from './db';

/**
 * Per-ownership analytics: impressions, clicks, CTR, daily traffic, top referrers.
 *
 * Everything here is scoped to a single Ownership row, never to a Word. A takeover always
 * starts a brand new Ownership with all of this at zero — see tests/ownership-stats.test.ts for
 * the exact BilimON/kursi24-style scenario (including a later reclaim) proving that.
 */

/** Truncates a timestamp to its UTC calendar day — the bucket key for daily rollups. */
export function dayBucketOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** CTR = unique clicks / impressions × 100. 0 impressions is 0%, never NaN or a fake number. */
export function calculateCtr(uniqueClicks: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return (uniqueClicks / impressions) * 100;
}

/**
 * Records one impression per (currently-owned) word in `normalizedWords` — called from the
 * client the moment a real browser actually rendered that word's listing (the leaderboard row
 * or its own word page). Unclaimed/blocked words and duplicates in the input are silently
 * skipped; this never throws into the caller's request.
 */
export async function recordImpressions(normalizedWords: string[]): Promise<void> {
  const unique = [...new Set(normalizedWords)].slice(0, 200); // a generous, sane upper bound
  if (unique.length === 0) return;

  const words = await prisma.word.findMany({
    where: { normalized: { in: unique }, blocked: false, currentOwnershipId: { not: null } },
    select: { currentOwnershipId: true },
  });
  const ownershipIds = words.map((w) => w.currentOwnershipId!).filter(Boolean);
  if (ownershipIds.length === 0) return;

  const today = dayBucketOf(new Date());

  await Promise.all(
    ownershipIds.map((ownershipId) =>
      prisma.$transaction([
        prisma.ownership.update({
          where: { id: ownershipId },
          data: { impressionCount: { increment: 1 } },
        }),
        prisma.ownershipDailyStat.upsert({
          where: { ownershipId_day: { ownershipId, day: today } },
          update: { impressions: { increment: 1 } },
          create: { ownershipId, day: today, impressions: 1 },
        }),
      ]),
    ),
  );
}

/** Increments today's click bucket for an ownership. Called alongside a valid click. */
export async function recordDailyClick(ownershipId: string): Promise<void> {
  const today = dayBucketOf(new Date());
  await prisma.ownershipDailyStat.upsert({
    where: { ownershipId_day: { ownershipId, day: today } },
    update: { clicks: { increment: 1 } },
    create: { ownershipId, day: today, clicks: 1 },
  });
}

export type ReferrerBreakdown = { referrer: string; count: number };

export type OwnershipPerformance = {
  impressions: number;
  validClicks: number;
  uniqueClicks: number;
  ctr: number;
  amountCents: number;
  startedAt: Date;
  todayClicks: number;
  last7DaysClicks: number;
  topReferrers: ReferrerBreakdown[];
};

/**
 * The full "OWNERSHIP PERFORMANCE" view for one ownership. Deliberately does NOT include
 * geography — there is no reliable, honest data source for that here (no geo-IP lookup, and we
 * are not adding one) — only what we can actually and simply measure: impressions, clicks, and
 * the Referer header already available on every outbound redirect.
 */
export async function getOwnershipPerformance(ownershipId: string): Promise<OwnershipPerformance | null> {
  const ownership = await prisma.ownership.findUnique({ where: { id: ownershipId } });
  if (!ownership) return null;

  const today = dayBucketOf(new Date());
  const sevenDaysAgo = dayBucketOf(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

  const [uniqueClicksResult, dailyRows, referrerRows] = await Promise.all([
    prisma.click.findMany({
      where: { ownershipId, valid: true },
      distinct: ['visitorHash'],
      select: { visitorHash: true },
    }),
    prisma.ownershipDailyStat.findMany({
      where: { ownershipId, day: { gte: sevenDaysAgo } },
      select: { day: true, clicks: true },
    }),
    prisma.click.groupBy({
      by: ['referrer'],
      where: { ownershipId, valid: true },
      _count: { _all: true },
      orderBy: { _count: { referrer: 'desc' } },
      take: 5,
    }),
  ]);

  const uniqueClicks = uniqueClicksResult.length;
  const todayClicks = dailyRows.find((r) => r.day.getTime() === today.getTime())?.clicks ?? 0;
  const last7DaysClicks = dailyRows.reduce((sum, r) => sum + r.clicks, 0);

  return {
    impressions: ownership.impressionCount,
    validClicks: ownership.clickCount,
    uniqueClicks,
    ctr: calculateCtr(uniqueClicks, ownership.impressionCount),
    amountCents: ownership.amountCents,
    startedAt: ownership.startedAt,
    todayClicks,
    last7DaysClicks,
    topReferrers: referrerRows.map((r) => ({
      referrer: r.referrer ?? 'direct',
      count: r._count._all,
    })),
  };
}
