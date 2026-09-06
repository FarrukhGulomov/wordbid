import { SITE_NAME } from './config';

/**
 * Founder-first X/Twitter share copy.
 *
 * The person sharing should feel like they're promoting their own company and the position it
 * just took — never like they're running an ad for WordBid, and never like they're taunting
 * whoever they took the word from. No AI is involved anywhere in this file: every sentence comes
 * from a fixed template filled in with real, already-stored data (word, brand name, real current
 * rank). When there isn't enough trustworthy real data for a richer sentence, this always falls
 * back to a safe, still-confident generic line rather than guessing or inventing anything.
 */

const CLOSING_POSITION = 'One word. One spot. A position worth owning.';
const CLOSING_BRAND = 'One word. One spot. Own what defines your brand.';

/**
 * Pulls a short "positioning" fragment out of a stored Owner description, safe to splice into
 * "We're building for <phrase>, so we claimed...". Deliberately conservative: a real scraped
 * website description (see src/lib/site-metadata.ts) is almost always a full marketing sentence,
 * not a short category phrase, and splicing one of those into that slot verbatim would often
 * read as broken or absurd — precisely what this guards against. Returns null (never a guess)
 * whenever the description doesn't clearly and safely fit the slot; the caller falls back to the
 * generic sentence in that case.
 */
export function extractPositioningPhrase(description: string | null): string | null {
  if (!description) return null;
  const text = description.trim();
  if (!text) return null;
  // A real category/positioning phrase reads short. A full sentence is not safe to splice in.
  if (text.length > 60) return null;
  // Any sentence-ending punctuation mid-phrase means this is prose, not a clean noun phrase.
  if (/[.!?]/.test(text)) return null;
  // A phrase opening with a subject pronoun would create a broken double-subject once spliced
  // after "We're building for" (e.g. "...for We help teams ship faster").
  if (/^(we're|we|our|it's|it|i|you)\b/i.test(text)) return null;
  return text.toLowerCase();
}

export type ShareContext =
  | { kind: 'claim'; word: string; description: string | null }
  | { kind: 'takeover'; word: string; brandName: string }
  | { kind: 'reclaim'; word: string; brandName: string }
  | { kind: 'boost'; word: string; brandName: string; rank: number | null };

/** The tweet body only — never the URL. It travels as X's separate `url` intent param instead,
 * so it renders as one real link, not embedded (and potentially duplicated) inside the text. */
export function buildShareText(ctx: ShareContext): string {
  let first: string;
  let closing: string;

  switch (ctx.kind) {
    case 'claim': {
      const phrase = extractPositioningPhrase(ctx.description);
      first = phrase
        ? `We're building for ${phrase}, so we claimed ${ctx.word} on ${SITE_NAME}. 👑`
        : `We claimed ${ctx.word} on ${SITE_NAME}. 👑`;
      closing = CLOSING_POSITION;
      break;
    }
    case 'takeover':
      first = `We just claimed the ${ctx.word} spot for ${ctx.brandName} on ${SITE_NAME}. 👑`;
      closing = CLOSING_BRAND;
      break;
    case 'reclaim':
      first = `${ctx.word} is back with ${ctx.brandName} on ${SITE_NAME}. 👑`;
      closing = CLOSING_POSITION;
      break;
    case 'boost':
      // Only ever states a rank actually read from the database — never an assumed improvement.
      first = ctx.rank
        ? `${ctx.brandName} is now #${ctx.rank} for ${ctx.word} on ${SITE_NAME}. ↑`
        : `${ctx.brandName} just strengthened its position on ${ctx.word} on ${SITE_NAME}. 👑`;
      closing = CLOSING_POSITION;
      break;
  }

  return `${first}\n\n${closing}`;
}
