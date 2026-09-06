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
  const [claimedWords, ownerships, payments, clicks, refundsPending, repeatBuyers, competitiveSpend] =
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
      prisma.ownership.groupBy({ by: ['ownerId'], _count: { _all: true } }).then(
        (rows) => rows.filter((row) => row._count._all > 1).length,
      ),
      getCompetitiveSpend(),
    ]);

  const totalOwnerships = ownerships._count;

  return {
    claimedWords,
    // Each confirmed ownership is one paying brand placement.
    payingOwners: totalOwnerships,
    confirmedPayments: payments._count,
    revenueCents: payments._sum.amountCents ?? 0,
    // Every ownership after the first on a word is a takeover.
    takeovers: Math.max(0, totalOwnerships - claimedWords),
    repeatBuyers,
    outboundClicks: clicks,
    averageOwnershipValueCents: Math.round(ownerships._avg.amountCents ?? 0),
    refundsPending,
    boostSpendCents: competitiveSpend.boostSpendCents,
    takeoverSpendCents: competitiveSpend.takeoverSpendCents,
    competitiveSpendCents: competitiveSpend.takeoverSpendCents + competitiveSpend.boostSpendCents,
  };
}
