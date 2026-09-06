import type { NotificationProvider, TakeoverNotice } from './types';

/**
 * Default provider. No external service, no API key, no cost — mirrors
 * src/lib/payments/mock.ts's role for payments: a legitimate default for local development and
 * for anyone running WordBid who hasn't (yet) configured real email delivery, not a stub to
 * delete later. A takeover notice is still genuinely "prepared" (logged, inspectable, complete)
 * even when nothing is actually emailed.
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = 'console';

  async sendTakeoverNotice(notice: TakeoverNotice): Promise<void> {
    console.log(
      `[notify] ${notice.wordDisplay} taken from ${notice.previousOwnerName} by ${notice.newOwnerName} — ` +
        `would email ${notice.toEmail} (reclaim ${notice.wordNormalized} for ${notice.reclaimPriceCents}¢, ` +
        `previous performance: ${notice.previousClicks} clicks / ${notice.previousImpressions} impressions)`,
    );
  }
}
