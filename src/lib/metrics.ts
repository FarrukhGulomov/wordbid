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
  const [claimedWords, ownerships, payments, clicks, refundsPending, byBrand] = await Promise.all([
    prisma.word.count({ where: { currentOwnershipId: { not: null } } }),
    prisma.ownership.aggregate({ _count: true, _avg: { amountCents: true } }),
    prisma.payment.aggregate({
      where: { status: 'CONFIRMED' },
      _count: true,
      _sum: { amountCents: true },
    }),
    prisma.click.count({ where: { valid: true } }),
    prisma.payment.count({ where: { status: 'REFUND_PENDING' } }),
    // Owner rows are created per checkout, so "the same buyer" is matched on brand + link.
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT o.name, o.url
        FROM "Ownership" ow
        JOIN "Owner" o ON o.id = ow."ownerId"
        GROUP BY o.name, o.url
        HAVING COUNT(*) > 1
      ) repeat_buyers`,
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
    repeatBuyers: Number(byBrand[0]?.count ?? 0n),
    outboundClicks: clicks,
    averageOwnershipValueCents: Math.round(ownerships._avg.amountCents ?? 0),
    refundsPending,
  };
}
