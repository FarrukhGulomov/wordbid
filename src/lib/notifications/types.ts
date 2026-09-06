/**
 * Notification provider abstraction — same shape as src/lib/payments/types.ts, for the same
 * reason: everything the rest of the app knows about sending a takeover notice is in this
 * interface, so swapping the email provider means writing one new file and changing one env var.
 */

export type TakeoverNotice = {
  toEmail: string;
  wordDisplay: string;
  wordNormalized: string;
  previousOwnerName: string;
  newOwnerName: string;
  /** The reclaim price observed at the moment this notice was prepared — see NotificationProvider. */
  reclaimPriceCents: number;
  /** The outgoing owner's real performance on this word, for exactly as long as they held it. */
  previousClicks: number;
  previousImpressions: number;
};

export interface NotificationProvider {
  readonly name: string;
  /**
   * Best-effort. A failure here must never break payment confirmation — see the try/catch
   * around this call in src/app/api/webhooks/payments/route.ts.
   */
  sendTakeoverNotice(notice: TakeoverNotice): Promise<void>;
}
