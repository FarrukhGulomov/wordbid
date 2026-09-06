import { prisma } from './db';

/**
 * The day-one numbers, computed from real rows only.
 *
 * Everything here is derived from confirmed payments, ownerships and valid clicks. Visitor
 * counts and referral traffic are deliberately absent — they need a web analytics tool, and
 * inventing them here would be worse than not showing them.
 */
export type Metrics = {
  claimedWords: number;
  payingOwners: number;
  confirmedPayments: number;
  revenueCents: number;
  takeovers: number;
  repeatBuyers: number;
  outboundClicks: number;
  averageOwnershipValueCents: number;
  refundsPending: number;
  boostSpendCents: number;
  /** Confirmed takeover/reclaim spend, across every word, excluding each word's first claim. */
  takeoverSpendCents: number;
  /** takeoverSpendCents + boostSpendCents — real money spent competing, never an initial claim. */
  competitiveSpendCents: number;
  /**
   * repeatBuyers ÷ distinct paying owners. 0 with no paying owners yet, never NaN. A brand is
   * "distinct" the same way repeatBuyers already counts it — one row per canonical domain (see
   * Owner), so this needs no fuzzy matching either.
   */
  repeatBuyerRate: number;
  /** Words that have changed hands at least once ÷ every claimed word. 0 with no claimed words. */
  wordCompetitionRate: number;
  /**
   * (TAKEOVER + RECLAIM + BOOST revenue) ÷ confirmed revenue — competitiveSpendCents already IS
   * that numerator (see its own doc comment for why TAKEOVER/RECLAIM/BOOST money never
   * double-counts). 0 with no confirmed revenue yet, never a divide-by-zero NaN.
   */
  competitiveRevenueShare: number;
};

/**
 * Platform-wide takeover/boost spend, split so an initial claim never counts as "competitive".
 *
 * Reads confirmed Payment rows directly rather than Ownership.amountCents: a boost mutates its
 * ownership's amountCents in place (see confirmPayment), so summing that would double-count a
 * boosted ownership's takeover price together with its boost money. Payment.amountCents is
 * immutable once confirmed, so this can't happen — see getWordCompetitiveSpend for the
 * per-word version of the same reasoning.
 */
async function getCompetitiveSpend(): Promise<{ takeoverSpendCents: number; boostSpendCents: number }> {
  const [takeoverPayments, boostAgg] = await Promise.all([
    prisma.payment.findMany({
      where: { kind: 'TAKEOVER', status: 'CONFIRMED' },
      select: { wordId: true, amountCents: true, ownership: { select: { startedAt: true } } },
    }),
    prisma.payment.aggregate({
      where: { kind: 'BOOST', status: 'CONFIRMED' },
      _sum: { amountCents: true },
    }),
  ]);

  // The earliest confirmed TAKEOVER payment per word is that word's initial claim.
  const earliestStartedAt = new Map<string, number>();
  for (const p of takeoverPayments) {
    const startedAt = p.ownership?.startedAt.getTime() ?? Number.POSITIVE_INFINITY;
    const seen = earliestStartedAt.get(p.wordId);
    if (seen === undefined || startedAt < seen) earliestStartedAt.set(p.wordId, startedAt);
  }
  const excludedFirstClaim = new Set<string>();
  let takeoverSpendCents = 0;
  for (const p of takeoverPayments) {
    const startedAt = p.ownership?.startedAt.getTime() ?? Number.POSITIVE_INFINITY;
    if (startedAt === earliestStartedAt.get(p.wordId) && !excludedFirstClaim.has(p.wordId)) {
      excludedFirstClaim.add(p.wordId);
      continue;
    }
    takeoverSpendCents += p.amountCents;
  }

  return { takeoverSpendCents, boostSpendCents: boostAgg._sum.amountCents ?? 0 };
}

export async function getMetrics(): Promise<Metrics> {
  const [claimedWords, ownerships, payments, clicks, refundsPending, buyerCounts, wordCounts, competitiveSpend] =
    await Promise.all([
      prisma.word.count({ where: { currentOwnershipId: { not: null } } }),
      prisma.ownership.aggregate({ _count: true, _avg: { amountCents: true } }),
      prisma.payment.aggregate({
        where: { status: 'CONFIRMED' },
        _count: true,
        _sum: { amountCents: true },
      }),
      prisma.click.count({ where: { valid: true } }),
      prisma.payment.count({ where: { status: 'REFUND_PENDING' } }),
      // Owner is one row per canonical domain (see checkout route), so a repeat buyer is simply
      // a domain with more than one confirmed ownership — no fuzzy matching needed.
      prisma.ownership.groupBy({ by: ['ownerId'], _count: { _all: true } }).then((rows) => ({
        distinctOwners: rows.length,
        repeatBuyers: rows.filter((row) => row._count._all > 1).length,
      })),
      // A word is "contested" the moment it has had more than one Ownership period, i.e. it
      // changed hands at least once (a takeover or a reclaim, same thing here — see
      // getWordCompetitiveSpend for why those are one category).
      prisma.ownership.groupBy({ by: ['wordId'], _count: { _all: true } }).then((rows) => ({
        contestedWords: rows.filter((row) => row._count._all > 1).length,
      })),
      getCompetitiveSpend(),
    ]);

  const totalOwnerships = ownerships._count;
  const revenueCents = payments._sum.amountCents ?? 0;
  const competitiveSpendCents = competitiveSpend.takeoverSpendCents + competitiveSpend.boostSpendCents;

  return {
    claimedWords,
    // Each confirmed ownership is one paying brand placement.
    payingOwners: totalOwnerships,
    confirmedPayments: payments._count,
    revenueCents,
    // Every ownership after the first on a word is a takeover.
    takeovers: Math.max(0, totalOwnerships - claimedWords),
    repeatBuyers: buyerCounts.repeatBuyers,
    outboundClicks: clicks,
    averageOwnershipValueCents: Math.round(ownerships._avg.amountCents ?? 0),
    refundsPending,
    boostSpendCents: competitiveSpend.boostSpendCents,
    takeoverSpendCents: competitiveSpend.takeoverSpendCents,
    competitiveSpendCents,
    repeatBuyerRate: buyerCounts.distinctOwners > 0 ? buyerCounts.repeatBuyers / buyerCounts.distinctOwners : 0,
    wordCompetitionRate: claimedWords > 0 ? wordCounts.contestedWords / claimedWords : 0,
    competitiveRevenueShare: revenueCents > 0 ? competitiveSpendCents / revenueCents : 0,
  };
}
