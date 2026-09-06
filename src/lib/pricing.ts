import { config } from './config';

/**
 * The lowest amount that will win a word right now.
 * Unowned  -> the configured starting price.
 * Owned    -> current value plus the configured premium, always at least one cent more.
 */
export function minimumBidCents(currentValueCents: number): number {
  if (currentValueCents <= 0) return config.startingPriceCents;
  const premium = Math.ceil((currentValueCents * config.takeoverIncrementPercent) / 100);
  return currentValueCents + Math.max(premium, 1);
}

/**
 * A bid wins only if it is strictly greater than the value it is competing against.
 * This is re-checked against the live value at payment confirmation time, never before.
 */
export function bidWins(bidCents: number, currentValueCents: number): boolean {
  return bidCents > currentValueCents;
}

export type BoostTarget = { rank: number; targetValueCents: number };

/**
 * The BOOST target for "move above this leaderboard row" — the same step minimumBidCents
 * already uses for a takeover, just applied to a competitor's value instead of your own. The
 * owner then pays only the difference between this target and their word's current value.
 */
export function boostTargetFor(row: { rank: number; valueCents: number }): BoostTarget {
  return { rank: row.rank, targetValueCents: minimumBidCents(row.valueCents) };
}
