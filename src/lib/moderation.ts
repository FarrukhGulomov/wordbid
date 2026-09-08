import { prisma } from './db';

/**
 * Moderation actions that touch more than a single flag flip — kept out of admin/page.tsx (a
 * Server Component) so they can be exercised directly in tests against a real database, the same
 * way every other business rule in this codebase is.
 */

export type UnblockWordResult = 'unblocked' | 'owner_still_blocked' | 'not_found';

/**
 * Reopens a moderated word — unless its current owner is STILL blocked (see F07). block_owner
 * blocks every word a suspended brand currently holds in one step; unblocking those words back
 * one at a time must never let one slip through while the brand itself remains suspended, or its
 * placement resurfaces on the leaderboard (see getLeaderboard/getWordByNormalized in queries.ts,
 * which also defend against this independently — this is the other half of that same fix).
 */
export async function unblockWord(wordId: string): Promise<UnblockWordResult> {
  const word = await prisma.word.findUnique({
    where: { id: wordId },
    select: { currentOwnership: { select: { owner: { select: { blocked: true } } } } },
  });
  if (!word) return 'not_found';
  if (word.currentOwnership?.owner.blocked) return 'owner_still_blocked';

  await prisma.word.update({ where: { id: wordId }, data: { blocked: false } });
  return 'unblocked';
}
