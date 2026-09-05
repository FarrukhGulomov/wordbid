/**
 * Product configuration. Everything a founder might want to tune lives here and is
 * driven by environment variables so it can change without a code deploy.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export const config = {
  /** Price to claim a word nobody owns yet, in cents. */
  get startingPriceCents(): number {
    return intFromEnv('STARTING_PRICE_CENTS', 1000);
  },
  /** Minimum premium over the current value required to take a word, in percent. */
  get takeoverIncrementPercent(): number {
    return intFromEnv('TAKEOVER_INCREMENT_PERCENT', 5);
  },
  /** Upper bound on a single claim, in cents. Guards against typos and abuse. */
  get maxAmountCents(): number {
    return intFromEnv('MAX_AMOUNT_CENTS', 100_000_00);
  },
  /** Repeat clicks by the same visitor on the same ownership inside this window are not counted. */
  get clickDedupeWindowMs(): number {
    return intFromEnv('CLICK_DEDUPE_WINDOW_MINUTES', 30) * 60 * 1000;
  },
  get siteUrl(): string {
    return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  },
  get paymentProvider(): string {
    return process.env.PAYMENT_PROVIDER || 'mock';
  },
} as const;

export const SITE_NAME = 'OwnTheInternet';
