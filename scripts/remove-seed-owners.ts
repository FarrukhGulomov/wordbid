/**
 * Removes any ownership data created by prisma/seed.ts (payment.provider === 'seed') from
 * whatever database DATABASE_URL points at — including production, if that is ever necessary.
 *
 * Safe by construction: the running app never creates a Payment with provider "seed" through a
 * real checkout (see src/lib/payments/index.ts), so this can only ever match demo/development
 * data seeded by `npm run db:seed`, never a real brand's ownership.
 *
 * Run with:
 *   npm run remove-seed-owners
 */
import { removeSeedOwnershipData } from '../src/lib/seed-cleanup';
import { prisma } from '../src/lib/db';

async function main() {
  const removed = await removeSeedOwnershipData();

  if (removed.length === 0) {
    console.log('No seed ownership data found. Nothing to remove.');
    return;
  }

  console.log(`Removed ${removed.length} seed ownership record(s):`);
  for (const r of removed) {
    console.log(`  "${r.word}" (was "${r.brand}")`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
