import { config, SITE_NAME } from '../config';
import { formatUsd } from '../money';
import type { NotificationProvider, TakeoverNotice } from './types';

/**
 * `notice.newOwnerName` / `previousOwnerName` are `Owner.name`, which is buyer-supplied free
 * text from checkout (see checkoutSchema's `brandName` — up to 60 chars, no HTML restriction).
 * Interpolating it into this email's HTML unescaped would let a buyer's own brand name break out
 * of the surrounding markup — see F12. Every user-controlled string below goes through this
 * before it reaches the HTML body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sends a real email through Resend's plain HTTP API — no SDK, no new npm dependency. Resend was
 * picked over building a generic SMTP client because its API is a single JSON POST with an API
 * key, which is the smallest amount of code that can actually deliver an email; swapping it for
 * another HTTP-based provider later is one new file implementing the same interface, exactly
 * like src/lib/payments/stripe.ts vs mock.ts.
 *
 * Requires RESEND_API_KEY and RESEND_FROM_EMAIL — see README's Environment variables table.
 */
export class ResendNotificationProvider implements NotificationProvider {
  readonly name = 'resend';
  private apiKey: string;
  private from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey) throw new Error('RESEND_API_KEY is not set');
    if (!from) throw new Error('RESEND_FROM_EMAIL is not set');
    this.apiKey = apiKey;
    this.from = from;
  }

  async sendTakeoverNotice(notice: TakeoverNotice): Promise<void> {
    const reclaimUrl = `${config.siteUrl}/claim?word=${encodeURIComponent(notice.wordNormalized)}`;
    const wordDisplay = escapeHtml(notice.wordDisplay);
    const newOwnerName = escapeHtml(notice.newOwnerName);
    const previousOwnerName = escapeHtml(notice.previousOwnerName);
    const performance =
      notice.previousClicks > 0 || notice.previousImpressions > 0
        ? `<p>While you held it: ${notice.previousImpressions} impressions, ${notice.previousClicks} clicks.</p>`
        : '';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        // The subject line is plain text, not HTML — it never needs (or should get) HTML
        // escaping, unlike the body below.
        subject: `${notice.newOwnerName} just took "${notice.wordDisplay}" on ${SITE_NAME}`,
        to: notice.toEmail,
        html:
          `<p><strong>${newOwnerName}</strong> took over "${wordDisplay}" from ` +
          `<strong>${previousOwnerName}</strong> on ${SITE_NAME}.</p>` +
          performance +
          `<p>Reclaim price as of this notice: <strong>${formatUsd(notice.reclaimPriceCents)}</strong> ` +
          `(the live price may have moved since — the link below always shows the current one).</p>` +
          `<p><a href="${reclaimUrl}">Reclaim "${wordDisplay}" →</a></p>`,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend responded ${res.status}: ${body.slice(0, 300)}`);
    }
  }
}
