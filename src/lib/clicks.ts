import crypto from 'node:crypto';
import { prisma } from './db';
import { config } from './config';
import { recordDailyClick } from './ownership-stats';

/**
 * Outbound click tracking.
 *
 * We store a salted hash of IP + user agent, never a raw IP. Repeated clicks by the same
 * visitor on the same ownership inside the dedupe window, and obvious bots, are recorded
 * but marked invalid so they never inflate the public number.
 */

const BOT_UA = /bot|crawl|spider|slurp|curl|wget|headless|preview|monitor|scan|python-requests|axios|okhttp|facebookexternalhit|whatsapp|telegram|discord|slack/i;

/** Salted hash of the visitor. Requires CLICK_HASH_SALT so hashes are not guessable. */
export function visitorHash(ip: string, userAgent: string): string {
  const salt = process.env.CLICK_HASH_SALT;
  if (!salt) throw new Error('CLICK_HASH_SALT is not set');
  return crypto.createHash('sha256').update(`${salt}|${ip}|${userAgent}`).digest('hex');
}

/** Best-effort client IP from proxy headers. Only ever used hashed. */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return headers.get('x-real-ip') || headers.get('cf-connecting-ip') || 'unknown';
}

export function looksLikeBot(userAgent: string): boolean {
  if (!userAgent) return true;
  return BOT_UA.test(userAgent);
}

/** Hostname only, never a full URL — that could leak the visitor's page path/query. */
export function referrerHostFrom(referer: string | null): string {
  if (!referer) return 'direct';
  try {
    return new URL(referer).hostname || 'direct';
  } catch {
    return 'direct';
  }
}

/**
 * A stable 64-bit signed key for `pg_advisory_xact_lock`, derived from the same visitor+ownership
 * pair recordClick dedupes on. Two different inputs may in principle collide (it's a truncated
 * hash), which would only ever over-serialise unrelated clicks — never under-serialise the one
 * pair that actually matters — so a collision is harmless for correctness.
 */
function advisoryLockKey(input: string): bigint {
  const digest = crypto.createHash('sha256').update(input).digest();
  const unsigned = digest.readBigUInt64BE(0);
  const SIGNED_64_MAX = (1n << 63n) - 1n;
  return unsigned > SIGNED_64_MAX ? unsigned - (1n << 64n) : unsigned;
}

/**
 * Records a click against an ownership and returns whether it counted publicly.
 * Never throws into the redirect path — a failed write must not break the visitor's journey.
 */
export async function recordClick(params: {
  ownershipId: string;
  wordId: string;
  ip: string;
  userAgent: string;
  referrer?: string | null;
}): Promise<boolean> {
  const hash = visitorHash(params.ip, params.userAgent);
  const bot = looksLikeBot(params.userAgent);
  const referrer = referrerHostFrom(params.referrer ?? null);
  const since = new Date(Date.now() - config.clickDedupeWindowMs);

  const valid = await prisma.$transaction(async (tx) => {
    // F10: the dedupe check used to run as a plain read BEFORE this transaction even started.
    // Two requests from the same visitor arriving close together (a double-click, a redirect
    // opened twice, a bot hammering the link) could both see "no recent click yet" before either
    // had committed its own insert, and both would then write valid:true — double-counting a
    // click that should have deduped to one. This lock serialises every click for the SAME
    // (ownership, visitor) pair: the second call's dedupe check now only ever runs after the
    // first one's insert has actually committed, so it always sees it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`${params.ownershipId}:${hash}`)})`;

    const recent = bot
      ? null
      : await tx.click.findFirst({
          where: {
            ownershipId: params.ownershipId,
            visitorHash: hash,
            valid: true,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
    const valid = !bot && !recent;

    await tx.click.create({
      data: {
        ownershipId: params.ownershipId,
        wordId: params.wordId,
        visitorHash: hash,
        valid,
        referrer,
      },
    });
    if (valid) {
      await tx.ownership.update({
        where: { id: params.ownershipId },
        data: { clickCount: { increment: 1 } },
      });
      await tx.word.update({
        where: { id: params.wordId },
        data: { clickCount: { increment: 1 } },
      });
    }
    return valid;
  });

  // Best-effort daily rollup for the ownership analytics view — never blocks the redirect.
  if (valid) {
    await recordDailyClick(params.ownershipId).catch((err) => {
      console.error('recordDailyClick failed', err);
    });
  }

  return valid;
}
