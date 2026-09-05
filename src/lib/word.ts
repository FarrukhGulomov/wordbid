/**
 * Word normalization and validation.
 *
 * `normalized` is the canonical identity of a word — one row per normalized form.
 * `display` is what we show, preserving the writer's spacing-free original casing.
 */

/** Routes and terms nobody may own, because they collide with the product itself. */
const RESERVED = new Set([
  'admin', 'api', 'www', 'root', 'null', 'undefined', 'owntheinternet', 'login', 'logout',
  'signup', 'signin', 'checkout', 'payment', 'payments', 'webhook', 'webhooks', 'word',
  'words', 'go', 'claim', 'about', 'terms', 'privacy', 'support', 'help', 'settings',
  'static', 'assets', 'public', 'favicon', 'robots', 'sitemap', 'health',
]);

/**
 * Terms we refuse outright. Deliberately short — a paid placement product needs a
 * moderation queue more than it needs a large word list, and blocked() covers the rest.
 */
const PROHIBITED = [
  'nigger', 'faggot', 'kike', 'chink', 'spic', 'rape', 'childporn', 'cp',
];

export const MIN_WORD_LENGTH = 1;
export const MAX_WORD_LENGTH = 30;

/**
 * Collapses the many ways of typing the same word into one key.
 * "AI", "ai", " Ai ", "A I" (no) -> "ai"; "Café" -> "cafe".
 */
export function normalizeWord(input: string): string {
  return input
    .normalize('NFKD')
    // Drop combining marks so "café" and "cafe" are the same word.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    // Any run of whitespace or underscores becomes a single hyphen.
    .replace(/[\s_]+/g, '-')
    // Collapse repeated hyphens and trim them from the edges.
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The form we store for display: original characters, whitespace tidied. */
export function displayWord(input: string): string {
  return input.normalize('NFKC').trim().replace(/[\s_]+/g, ' ');
}

export type WordValidation =
  | { ok: true; normalized: string; display: string }
  | { ok: false; error: string };

/** Validates a user-supplied word and returns both stored forms. */
export function validateWord(input: string): WordValidation {
  if (typeof input !== 'string') return { ok: false, error: 'Enter a word.' };

  const display = displayWord(input);
  const normalized = normalizeWord(input);

  if (normalized.length < MIN_WORD_LENGTH) {
    return { ok: false, error: 'Enter a word.' };
  }
  if (normalized.length > MAX_WORD_LENGTH) {
    return { ok: false, error: `Words can be at most ${MAX_WORD_LENGTH} characters.` };
  }
  // Letters (any script), digits and single inner hyphens only.
  if (!/^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u.test(normalized)) {
    return { ok: false, error: 'Use letters and numbers only. Spaces become hyphens.' };
  }
  if (RESERVED.has(normalized)) {
    return { ok: false, error: 'That word is reserved and cannot be claimed.' };
  }
  const stripped = normalized.replace(/-/g, '');
  if (PROHIBITED.some((term) => stripped.includes(term))) {
    return { ok: false, error: 'That word is not allowed.' };
  }

  return { ok: true, normalized, display };
}
