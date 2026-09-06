/**
 * BidRank — WordBid's ranking score, centralized so ranking logic lives in exactly one place.
 *
 * Today the only signal that can be calculated reliably and honestly is bid strength (the
 * word's current confirmed value) — there is no quality, engagement or trust data yet that
 * isn't either fabricated or a duplicate of something already shown elsewhere. Rather than
 * invent one, this module exists so a future signal is a weight added here, not a rewrite of
 * the leaderboard query or the payment path.
 *
 * Not exported to any client bundle or public API — the formula and its weights are a server
 * implementation detail, never a promise made to the outside world.
 */

export type BidRankSignals = {
  /** The word's current confirmed value, in cents. The only signal in production today. */
  bidStrengthCents: number;
};

/**
 * Weights are multipliers on each raw signal. Set so today's score is numerically identical to
 * bidStrengthCents alone — i.e. turning this module on changes nothing about current ranking
 * behavior. A future signal (quality/engagement/trust/freshness) gets its own field on
 * BidRankSignals and a non-zero weight here.
 *
 * Important: `Word.valueCents` is the indexed column the leaderboard actually sorts by in SQL
 * (see RANK_ORDER in src/lib/queries.ts) — as long as bidStrengthCents is the only weighted
 * signal, sorting by valueCents IS sorting by BidRank, and no computed column is needed. The
 * day a second signal gets a non-zero weight, ranking can no longer be a single indexed column
 * sort — that signal would need denormalising onto Word (e.g. a stored `bidRankScore` column,
 * recomputed whenever its inputs change) so the leaderboard can still sort in SQL rather than
 * re-ranking every word in application code on every read.
 */
const WEIGHTS = {
  bidStrength: 1,
} as const;

/** The authoritative ranking score for a word. Always computed server-side from stored data. */
export function computeBidRank(signals: BidRankSignals): number {
  return signals.bidStrengthCents * WEIGHTS.bidStrength;
}
