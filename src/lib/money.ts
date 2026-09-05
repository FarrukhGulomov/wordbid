/** Money is always integer cents internally. These helpers are the only place it becomes text. */

/** 482000 -> "$4,820". Cents are shown only when they are non-zero. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  const hasCents = cents % 100 !== 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(dollars);
}

/** 18420 -> "18,420" */
export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

/**
 * Parses user input like "500", "$500", "1,050.50" into cents.
 * Returns null when the input is not a usable amount.
 */
export function parseUsdToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number.parseFloat(cleaned) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}
