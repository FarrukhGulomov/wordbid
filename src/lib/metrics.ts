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
};

export async function getMetrics(): Promise<Metrics> {
  const [claimedWords, ownerships, payments, clicks, refundsPending, repeatBuyers] = await Promise.all([
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
  };
}
