import { prisma } from './db';
import { dayBucketOf } from './ownership-stats';
import { shortAgo } from './time';
import { formatCount } from './money';
import { getLeaderboard, type LeaderboardRow } from './queries';

/**
 * The attention engine — WordBid's centralized, server-only discovery scoring.
 *
 * Answers one question for a visitor who will never pay: "what's actually interesting right
 * now?" Every signal here is either a real confirmed payment (bid strength, via bidrank.ts) or
 * a real, bot-filtered, dedupe'd click/impression/rank observation already recorded elsewhere
 * in the codebase — nothing here invents data. If there isn't enough real activity to honestly
 * back a claim (Trending, Rising, Hidden Gem), the row is simply excluded — never a fabricated
 * placeholder.
 *
 * Paid vs earned, enforced by construction: every discovery view below is a function of clicks,
 * impressions and rank history — signals a founder cannot buy directly. Money buys `valueCents`,
 * which only ever competes for the Top view (via BidRank) and, in Hidden Gems, actively works
 * AGAINST eligibility (see hiddenGemScore) — paying more can only push a word toward Top, never
 * toward Trending, Rising or Hidden Gem.
 *
 * Thresholds are internal constants, not exposed on any public API or client bundle, same as
 * bidrank.ts's weights.
 */

// A word must be found within this many rows of the value-ranked board to be considered for any
// discovery view — a generous cap for MVP scale, not a claim that this scans "all" words. See
// the README's BidRank/discovery section for the scaling note.
const BOARD_SCAN_LIMIT = 500;

const TRENDING_WINDOW_DAYS = 7;
const MIN_TRENDING_CLICKS = 3;

const RISING_WINDOW_DAYS = 14;
const MIN_RISING_AGE_DAYS = 3;
const MIN_RISING_DELTA = 2;

const HIDDEN_GEM_WINDOW_DAYS = 7;
const MIN_HIDDEN_GEM_IMPRESSIONS = 20;
/** A word already this close to the top is visible by definition — not "hidden". */
const HIDDEN_GEM_EXCLUDE_TOP_N = 3;

// --- Pure, testable scoring — no I/O below this line except the query helpers further down. ---

export function trendingScore(signals: { recentClicks: number }): number {
  return signals.recentClicks;
}

export function isTrending(signals: { recentClicks: number }): boolean {
  return signals.recentClicks >= MIN_TRENDING_CLICKS;
}

/** Positive = climbed (a smaller rank number today than at the older observation). */
export function risingDelta(priorRank: number, currentRank: number): number {
  return priorRank - currentRank;
}

export function isRising(delta: number): boolean {
  return delta >= MIN_RISING_DELTA;
}

export function isHiddenGemEligible(signals: { rank: number; recentImpressions: number }): boolean {
  return signals.rank > HIDDEN_GEM_EXCLUDE_TOP_N && signals.recentImpressions >= MIN_HIDDEN_GEM_IMPRESSIONS;
}

/**
 * Earned engagement (CTR) divided by a dampened promotion penalty that grows with the word's
 * paid value. A word can only ever lower its own score by paying more — there is no way to
 * raise this number with money, only with real clicks relative to real impressions.
 */
export function hiddenGemScore(signals: {
  recentClicks: number;
  recentImpressions: number;
  valueCents: number;
}): number {
  const ctr = signals.recentImpressions > 0 ? signals.recentClicks / signals.recentImpressions : 0;
  const promotionPenalty = Math.log10(signals.valueCents / 100 + 10);
  return ctr / promotionPenalty;
}

// --- Query helpers: bounded, not N+1 — each is at most two queries regardless of word count. ---

/**
 * Real clicks/impressions earned by each word's CURRENT ownership only, over the trailing
 * `days` window — a word that changed hands mid-window never inherits a previous owner's
 * numbers, same rule as everywhere else in this codebase (see Word.clickCount's doc comment).
 */
async function getRecentEngagementByWord(
  wordIds: string[],
  days: number,
): Promise<Map<string, { clicks: number; impressions: number }>> {
  if (wordIds.length === 0) return new Map();

  const words = await prisma.word.findMany({
    where: { id: { in: wordIds }, currentOwnershipId: { not: null } },
    select: { id: true, currentOwnershipId: true },
  });
  const wordIdByOwnershipId = new Map(words.map((w) => [w.currentOwnershipId!, w.id]));
  if (wordIdByOwnershipId.size === 0) return new Map();

  const since = dayBucketOf(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const grouped = await prisma.ownershipDailyStat.groupBy({
    by: ['ownershipId'],
    where: { ownershipId: { in: [...wordIdByOwnershipId.keys()] }, day: { gte: since } },
    _sum: { clicks: true, impressions: true },
  });

  const result = new Map<string, { clicks: number; impressions: number }>();
  for (const g of grouped) {
    const wordId = wordIdByOwnershipId.get(g.ownershipId);
    if (!wordId) continue;
    result.set(wordId, { clicks: g._sum.clicks ?? 0, impressions: g._sum.impressions ?? 0 });
  }
  return result;
}

/**
 * The rank each word had at the OLDEST real observation between `days` and `MIN_RISING_AGE_DAYS`
 * ago — not exactly N days ago, just the most distant real data point available in that window.
 * A word with no observation in range is simply absent from the result — there is nothing
 * honest to compare against yet.
 */
async function getPriorRankByWord(wordIds: string[], days: number): Promise<Map<string, number>> {
  if (wordIds.length === 0) return new Map();

  const lowerBound = dayBucketOf(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const upperBound = dayBucketOf(new Date(Date.now() - MIN_RISING_AGE_DAYS * 24 * 60 * 60 * 1000));
  const snapshots = await prisma.rankSnapshot.findMany({
    where: { wordId: { in: wordIds }, day: { gte: lowerBound, lte: upperBound } },
    orderBy: { day: 'asc' },
    select: { wordId: true, rank: true },
  });

  const oldestRankByWord = new Map<string, number>();
  for (const s of snapshots) {
    if (!oldestRankByWord.has(s.wordId)) oldestRankByWord.set(s.wordId, s.rank);
  }
  return oldestRankByWord;
}

// --- Public discovery views — each returns the same LeaderboardRow shape, just filtered, ---
// --- reordered and annotated with a real-data highlight. One system, five views. ---

/** Real, meaningful recent attention — never payment alone. */
export async function getTrendingWords(limit = 10): Promise<LeaderboardRow[]> {
  const board = await getLeaderboard(BOARD_SCAN_LIMIT);
  const engagement = await getRecentEngagementByWord(
    board.map((r) => r.wordId),
    TRENDING_WINDOW_DAYS,
  );

  return board
    .map((row) => ({ row, clicks: engagement.get(row.wordId)?.clicks ?? 0 }))
    .filter(({ clicks }) => isTrending({ recentClicks: clicks }))
    .sort((a, b) => trendingScore({ recentClicks: b.clicks }) - trendingScore({ recentClicks: a.clicks }))
    .slice(0, limit)
    .map(({ row, clicks }) => ({
      ...row,
      highlight: `🔥 ${formatCount(clicks)} click${clicks === 1 ? '' : 's'} this week`,
    }));
}

/** Words climbing the leaderboard quickly, measured against a real prior observation. */
export async function getRisingWords(limit = 10): Promise<LeaderboardRow[]> {
  const board = await getLeaderboard(BOARD_SCAN_LIMIT);
  const priorRanks = await getPriorRankByWord(
    board.map((r) => r.wordId),
    RISING_WINDOW_DAYS,
  );

  return board
    .flatMap((row) => {
      const priorRank = priorRanks.get(row.wordId);
      if (priorRank === undefined) return [];
      const delta = risingDelta(priorRank, row.rank);
      if (!isRising(delta)) return [];
      return [{ row, delta }];
    })
    .sort((a, b) => b.delta - a.delta)
    .slice(0, limit)
    .map(({ row, delta }) => ({ ...row, highlight: `🚀 Up ${formatCount(delta)} this week` }));
}

/** Strong real engagement despite modest paid promotion — never purchasable. */
export async function getHiddenGems(limit = 10): Promise<LeaderboardRow[]> {
  const board = await getLeaderboard(BOARD_SCAN_LIMIT);
  const engagement = await getRecentEngagementByWord(
    board.map((r) => r.wordId),
    HIDDEN_GEM_WINDOW_DAYS,
  );

  return board
    .flatMap((row) => {
      const stats = engagement.get(row.wordId);
      if (!stats) return [];
      if (!isHiddenGemEligible({ rank: row.rank, recentImpressions: stats.impressions })) return [];
      const score = hiddenGemScore({
        recentClicks: stats.clicks,
        recentImpressions: stats.impressions,
        valueCents: row.valueCents,
      });
      return [{ row, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({ ...row, highlight: '💎 Real engagement, modest spend' }));
}

/** Most recently claimed — chronological, never gated by payment amount. */
export async function getNewArrivals(limit = 10): Promise<LeaderboardRow[]> {
  const board = await getLeaderboard(BOARD_SCAN_LIMIT);
  return [...board]
    .sort((a, b) => b.ownedSince.getTime() - a.ownedSince.getTime())
    .slice(0, limit)
    .map((row) => ({ ...row, highlight: `🆕 Claimed ${shortAgo(row.ownedSince)}` }));
}
