/**
 * Retries every payment stuck REFUND_PENDING — money captured for a word that was not won,
 * whose refund did not complete when the webhook first tried it.
 *
 * Run this on a schedule (e.g. every 15 minutes via cron or a platform scheduled job):
 *   npm run reconcile-refunds
 *
 * Exits non-zero if anything is still stuck after the attempt, so a cron runner's own
 * failure alerting picks it up without extra plumbing.
 */
import { reconcileAllPendingRefunds } from '../src/lib/refunds';
import { prisma } from '../src/lib/db';

async function main() {
  const results = await reconcileAllPendingRefunds();

  if (results.length === 0) {
    console.log('No refunds pending.');
    return;
  }

  const refunded = results.filter((r) => r.outcome === 'refunded');
  const failed = results.filter((r) => r.outcome === 'failed');

  console.log(`Refunded ${refunded.length}/${results.length} pending payment(s).`);
  for (const r of failed) {
    console.error(`  STILL PENDING: payment ${r.paymentId} — ${r.error}`);
  }

  if (failed.length > 0) {
    console.error(
      `${failed.length} payment(s) still need attention. Check your payment provider dashboard and /admin.`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
