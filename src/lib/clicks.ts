import crypto from 'node:crypto';
import { prisma } from './db';
import { config } from './config';

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

/**
 * Records a click against an ownership and returns whether it counted publicly.
 * Never throws into the redirect path — a failed write must not break the visitor's journey.
 */
export async function recordClick(params: {
  ownershipId: string;
  wordId: string;
  ip: string;
  userAgent: string;
}): Promise<boolean> {
  const hash = visitorHash(params.ip, params.userAgent);
  const bot = looksLikeBot(params.userAgent);

  const since = new Date(Date.now() - config.clickDedupeWindowMs);
  const recent = bot
    ? null
    : await prisma.click.findFirst({
        where: {
          ownershipId: params.ownershipId,
          visitorHash: hash,
          valid: true,
          createdAt: { gte: since },
        },
        select: { id: true },
      });

  const valid = !bot && !recent;

  await prisma.$transaction(async (tx) => {
    await tx.click.create({
      data: { ownershipId: params.ownershipId, wordId: params.wordId, visitorHash: hash, valid },
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
  });

  return valid;
}
