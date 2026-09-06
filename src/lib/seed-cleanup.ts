import type { PrismaClient } from '@prisma/client';
import { prisma } from './db';

export type RemovedSeedOwnership = { word: string; brand: string };

/**
 * Deletes every ownership record that originated from prisma/seed.ts (payment.provider ===
 * 'seed') and resets the affected word back to unowned so a real brand can claim it normally.
 *
 * Safe to run against any environment, including production: the running app itself can never
 * create a Payment with provider "seed" — src/lib/payments/index.ts only ever produces "mock" or
 * "stripe" — so this can only ever match demo/development data, never a real checkout.
 */
export async function removeSeedOwnershipData(
  client: PrismaClient = prisma,
): Promise<RemovedSeedOwnership[]> {
  const seedPayments = await client.payment.findMany({
    where: { provider: 'seed' },
    include: { word: true, owner: true },
  });

  const removed: RemovedSeedOwnership[] = [];

  for (const payment of seedPayments) {
    await client.$transaction(async (tx) => {
      // Detach the word from its seed ownership first — Word.currentOwnershipId would
      // otherwise still point at the Ownership row this is about to delete.
      if (payment.word.currentOwnershipId) {
        await tx.word.update({
          where: { id: payment.wordId },
          data: { currentOwnershipId: null, valueCents: 0, ownedSince: null },
        });
      }
      await tx.click.deleteMany({ where: { ownership: { paymentId: payment.id } } });
      await tx.ownershipDailyStat.deleteMany({ where: { ownership: { paymentId: payment.id } } });
      await tx.ownership.deleteMany({ where: { paymentId: payment.id } });
      await tx.activity.deleteMany({ where: { wordId: payment.wordId, ownerId: payment.ownerId } });
      await tx.payment.delete({ where: { id: payment.id } });

      // The seed Owner row goes too, but only once nothing else references it.
      const remainingPayments = await tx.payment.count({ where: { ownerId: payment.ownerId } });
      if (remainingPayments === 0) {
        await tx.owner.delete({ where: { id: payment.ownerId } });
      }
    });

    removed.push({ word: payment.word.display, brand: payment.owner.name });
  }

  return removed;
}
