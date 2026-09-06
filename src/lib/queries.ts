import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { minimumBidCents } from './pricing';

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
};

/** The ranking order, in one place: value first, then the earlier ownership, then a stable id. */
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

  return {
    ...word,
    rank: await getRank(word.id),
    minimumBidCents: minimumBidCents(word.valueCents),
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
