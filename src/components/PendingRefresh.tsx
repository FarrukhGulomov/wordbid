'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** After this long, a pending payment stops being "normal" and the buyer is told what to do. */
const SLOW_AFTER_SECONDS = 45;

/**
 * The waiting state of a payment: re-fetches the server component every few seconds until the
 * webhook lands, and — crucially — tells the buyer what is happening while it does.
 *
 * WordBid has no login, so this URL is the buyer's ONLY handle on a payment they have already
 * made. The screen used to be a headline and the word "Checking…", with nothing moving, no sense
 * of how long it had been, and no way out if the provider never confirmed — the exact conditions
 * under which someone closes the tab and loses the only reference to their money. So: a live
 * spinner and elapsed count so the page is visibly working, a copyable link so leaving is safe,
 * and after SLOW_AFTER_SECONDS an honest "this is taking longer than usual" with a real next step.
 */
export function PendingRefresh({
  intervalMs = 3000,
  supportEmail = null,
}: {
  intervalMs?: number;
  /** Only rendered when the operator has actually configured one — never a fabricated address. */
  supportEmail?: string | null;
}) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const slow = seconds >= SLOW_AFTER_SECONDS;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, permission denied) — the URL is still in the bar.
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-sm">
      <p
        className="flex items-center justify-center gap-2 font-mono text-xs text-muted"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-gold"
        />
        Checking… <span className="tnum">{seconds}s</span>
      </p>

      {/* Without an account, losing this tab means losing the only pointer to the payment. */}
      <div className="mt-6 rounded border border-line bg-surface-2 p-3 text-left text-xs text-muted">
        <p className="font-bold text-text">Keep this link</p>
        <p className="mt-1">
          There are no accounts on WordBid — this page is your only record of this payment.
          Save it before you close the tab.
        </p>
        <button
          type="button"
          onClick={copyLink}
          className="mt-2 inline-flex min-h-8 items-center rounded border border-line px-3 font-mono text-[11px] font-bold text-text transition hover:border-gold hover:text-gold"
        >
          {copied ? 'LINK COPIED' : 'COPY THIS LINK'}
        </button>
      </div>

      {slow && (
        <div className="mt-3 rounded border border-gold/40 bg-gold/10 p-3 text-left text-xs text-gold">
          <p className="font-bold">This is taking longer than usual.</p>
          <p className="mt-1">
            Payments normally confirm in a few seconds. Your money is not lost, and you were only
            charged if your provider completed the payment — but the confirmation has not reached
            us yet. Leave this page open, or come back to this same link later.
          </p>
          {supportEmail && (
            <p className="mt-2">
              Still nothing?{' '}
              <a
                href={`mailto:${supportEmail}?subject=${encodeURIComponent('Payment still pending')}`}
                className="inline-flex min-h-6 items-center align-middle underline underline-offset-2"
              >
                Email {supportEmail}
              </a>{' '}
              with this link.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
