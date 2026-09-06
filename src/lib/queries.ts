import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { minimumBidCents } from './pricing';
import { computeBidRank } from './bidrank';
import { dayBucketOf } from './ownership-stats';

/**
 * Read models for the public surfaces.
 *
 * Ranking rule (single source of truth): current word value DESC, and for equal values the
 * ownership that was confirmed earlier ranks first.
 */

export type LeaderboardRow = {
  rank: number;
  wordId: string;
  normalized: string;
  display: string;
  valueCents: number;
  clickCount: number;
  ownerName: string;
  ownerUrl: string;
  ownerLogoUrl: string | null;
  minimumBidCents: number;
  /** The authoritative BidRank score behind this row's position. Not rendered — see bidrank.ts. */
  bidRankScore: number;
};

/**
 * The ranking order, in one place: value first, then the earlier ownership, then a stable id.
 * `valueCents` here IS the word's BidRank score today — see src/lib/bidrank.ts for why sorting
 * by this one indexed column is equivalent to sorting by BidRank as long as bid strength is the
 * only weighted signal, and what changes the day a second signal joins it.
 */
const RANK_ORDER: Prisma.WordOrderByWithRelationInput[] = [
  { valueCents: 'desc' },
  { ownedSince: 'asc' },
  { id: 'asc' },
];

/** The global leaderboard. Only words with a confirmed current owner appear. */
export async function getLeaderboard(limit = 50, skip = 0): Promise<LeaderboardRow[]> {
  const words = await prisma.word.findMany({
    where: { blocked: false, currentOwnershipId: { not: null } },
    orderBy: RANK_ORDER,
    take: limit,
    skip,
    include: {
      currentOwnership: { include: { owner: true } },
    },
  });

  return words.flatMap((word, i) => {
    const owner = word.currentOwnership?.owner;
    if (!owner) return [];
    return [
      {
        rank: skip + i + 1,
        wordId: word.id,
        normalized: word.normalized,
        display: word.display,
        valueCents: word.valueCents,
        // Clicks belong to the ownership that earned them, not to the word across every owner
        // it has ever had — word.clickCount is a lifetime total, never shown here.
        clickCount: word.currentOwnership!.clickCount,
        ownerName: owner.name,
        ownerUrl: owner.url,
        ownerLogoUrl: owner.logoUrl,
        minimumBidCents: minimumBidCents(word.valueCents),
        bidRankScore: computeBidRank({ bidStrengthCents: word.valueCents }),
      },
    ];
  });
}

/**
 * Up to 3 real leaderboard rows above a given rank, to suggest as BOOST targets: the row
 * directly above (cheapest to clear), the current #1, and the midpoint between them.
 * Deduplicated by rank. Empty for rank 1 — there is nothing to boost above.
 */
export async function getBoostCandidates(rank: number): Promise<LeaderboardRow[]> {
  if (rank <= 1) return [];
  const skips = new Set([0, Math.floor((rank - 1) / 2), rank - 2]);
  const rows = await Promise.all([...skips].map((skip) => getLeaderboard(1, skip)));
  const byRank = new Map(rows.flat().map((row) => [row.rank, row]));
  return [...byRank.values()].sort((a, b) => a.valueCents - b.valueCents);
}

export async function countOwnedWords(): Promise<number> {
  return prisma.word.count({ where: { blocked: false, currentOwnershipId: { not: null } } });
}

/** 1-based global rank of an owned word, or null when the word is unowned. */
export async function getRank(wordId: string): Promise<number | null> {
  const word = await prisma.word.findUnique({ where: { id: wordId } });
  if (!word || word.blocked || !word.currentOwnershipId || !word.ownedSince) return null;

  const above = await prisma.word.count({
    where: {
      blocked: false,
      currentOwnershipId: { not: null },
      OR: [
        { valueCents: { gt: word.valueCents } },
        { valueCents: word.valueCents, ownedSince: { lt: word.ownedSince } },
        { valueCents: word.valueCents, ownedSince: word.ownedSince, id: { lt: word.id } },
      ],
    },
  });
  return above + 1;
}

/**
 * Records today's observed rank/value for a word — real, observed state only, never backfilled
 * or estimated. Upserted per (word, day), so repeated views on the same day just refresh today's
 * row. Best-effort: a write failure here must never break the page that triggered it.
 */
async function recordRankSnapshot(wordId: string, rank: number, valueCents: number): Promise<void> {
  try {
    await prisma.rankSnapshot.upsert({
      where: { wordId_day: { wordId, day: dayBucketOf(new Date()) } },
      update: { rank, valueCents },
      create: { wordId, day: dayBucketOf(new Date()), rank, valueCents },
    });
  } catch (err) {
    console.error('recordRankSnapshot failed', err);
  }
}

/**
 * Rank change since the most recent PRIOR day a snapshot exists for — not necessarily
 * yesterday, just the last time this word's rank was actually observed before today. Positive
 * means the word moved up (a smaller rank number); null means there is no prior observation to
 * compare against, in which case nothing should be shown — never a fabricated "no change".
 */
async function getRankDeltaSince(wordId: string, currentRank: number): Promise<number | null> {
  const previous = await prisma.rankSnapshot.findFirst({
    where: { wordId, day: { lt: dayBucketOf(new Date()) } },
    orderBy: { day: 'desc' },
  });
  return previous ? previous.rank - currentRank : null;
}

export type WordDetail = NonNullable<Awaited<ReturnType<typeof getWordByNormalized>>>;

/** Full word page payload: current owner, price to take it, and the complete history. */
export async function getWordByNormalized(normalized: string) {
  const word = await prisma.word.findUnique({
    where: { normalized },
    include: {
      currentOwnership: { include: { owner: true } },
      ownerships: {
        orderBy: { startedAt: 'desc' },
        include: { owner: { select: { name: true, url: true, logoUrl: true } } },
      },
    },
  });
  if (!word || word.blocked) return null;

  const rank = await getRank(word.id);

  let rankDelta: number | null = null;
  let costToReachNumberOneCents: number | null = null;
  if (rank !== null) {
    rankDelta = await getRankDeltaSince(word.id, rank);
    await recordRankSnapshot(word.id, rank, word.valueCents);
    if (rank > 1) {
      const [topRow] = await getLeaderboard(1, 0);
      if (topRow) costToReachNumberOneCents = minimumBidCents(topRow.valueCents);
    }
  }

  return {
    ...word,
    rank,
    rankDelta,
    costToReachNumberOneCents,
    minimumBidCents: minimumBidCents(word.valueCents),
  };
}

/**
 * True when the ownership a TAKEOVER payment created was the word's very first — i.e. this was
 * a claim, not a takeover or reclaim. A BOOST payment never creates an ownership of its own
 * (see confirmPayment's BOOST branch) and so is never "first" — this only means something for
 * TAKEOVER-kind payments.
 */
export async function isFirstClaimPayment(paymentId: string): Promise<boolean> {
  const ownership = await prisma.ownership.findUnique({
    where: { paymentId },
    select: { wordId: true, startedAt: true },
  });
  if (!ownership) return false;
  const earlierCount = await prisma.ownership.count({
    where: { wordId: ownership.wordId, startedAt: { lt: ownership.startedAt } },
  });
  return earlierCount === 0;
}

export type CompetitiveSpend = {
  /** Ownership changes after the first claim — a takeover or a reclaim, same thing here. */
  takeoverCount: number;
  takeoverSpendCents: number;
  boostSpendCents: number;
  /** Confirmed TAKEOVER/reclaim spend plus confirmed BOOST spend. Never counts the first claim. */
  competitiveSpendCents: number;
};

/**
 * Real, confirmed money spent competing for a word — never the initial claim.
 *
 * Deliberately reads confirmed Payment rows directly rather than summing Ownership.amountCents:
 * a boost mutates its ownership's amountCents in place (see confirmPayment), so an ownership
 * that was later boosted would otherwise have its takeover price AND its boost money counted
 * together under "takeover spend", double-counting the boost. Payment.amountCents is immutable
 * once confirmed and is exactly what changed hands for that one payment, so this can't happen.
 */
export async function getWordCompetitiveSpend(wordId: string): Promise<CompetitiveSpend> {
  const [firstOwnership, takeoverPayments, boostAgg] = await Promise.all([
    prisma.ownership.findFirst({
      where: { wordId },
      orderBy: { startedAt: 'asc' },
      select: { paymentId: true },
    }),
    prisma.payment.findMany({
      where: { wordId, kind: 'TAKEOVER', status: 'CONFIRMED' },
      select: { id: true, amountCents: true },
    }),
    prisma.payment.aggregate({
      where: { wordId, kind: 'BOOST', status: 'CONFIRMED' },
      _sum: { amountCents: true },
    }),
  ]);

  const takeoverSpendCents = takeoverPayments
    .filter((p) => p.id !== firstOwnership?.paymentId)
    .reduce((sum, p) => sum + p.amountCents, 0);
  const boostSpendCents = boostAgg._sum.amountCents ?? 0;

  return {
    takeoverCount: Math.max(0, takeoverPayments.length - 1),
    takeoverSpendCents,
    boostSpendCents,
    competitiveSpendCents: takeoverSpendCents + boostSpendCents,
  };
}

/** Recent ownership changes for the live feed. */
export async function getRecentActivity(limit = 8) {
  return prisma.activity.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      word: { select: { display: true, normalized: true, blocked: true } },
      owner: { select: { name: true } },
    },
    where: { word: { blocked: false } },
  });
}

/** Words claimed most recently — a lightweight discovery strip under the leaderboard. */
export async function getRecentlyClaimed(limit = 6) {
  const words = await prisma.word.findMany({
    where: { blocked: false, currentOwnershipId: { not: null } },
    orderBy: { ownedSince: 'desc' },
    take: limit,
    include: { currentOwnership: { include: { owner: { select: { name: true } } } } },
  });
  return words;
}

/** Words with the most ownership changes — "most fought over". */
export async function getMostFoughtOver(limit = 6) {
  const grouped = await prisma.ownership.groupBy({
    by: ['wordId'],
    _count: { _all: true },
    orderBy: { _count: { wordId: 'desc' } },
    take: limit * 2,
  });
  const contested = grouped.filter((g) => g._count._all > 1);
  if (contested.length === 0) return [];

  const words = await prisma.word.findMany({
    where: { id: { in: contested.map((g) => g.wordId) }, blocked: false },
    include: { currentOwnership: { include: { owner: { select: { name: true } } } } },
  });
  const counts = new Map(contested.map((g) => [g.wordId, g._count._all]));

  return words
    .map((w) => ({ word: w, takeovers: (counts.get(w.id) ?? 1) - 1 }))
    .sort((a, b) => b.takeovers - a.takeovers)
    .slice(0, limit);
}
