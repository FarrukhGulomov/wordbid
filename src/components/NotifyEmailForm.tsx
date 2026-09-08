/**
 * Optional, post-payment only — see src/lib/notify-email.ts for why `paymentId` alone is an
 * appropriate proof of "this is the same buyer" in a product with no login. Never required to
 * complete a checkout; this only ever renders after one already succeeded.
 *
 * `maskedCurrentEmail` is deliberately masked (never the raw address) and is never used to
 * prefill the input — see F04 in src/lib/notify-email.ts: Owner is keyed by an unverified
 * domain, so whoever set the existing address may not be whoever is looking at this page.
 *
 * A plain server component: the action prop is a Server Action, so no client JS is needed here.
 */
export function NotifyEmailForm({
  action,
  paymentId,
  maskedCurrentEmail,
  wordDisplay,
}: {
  action: (formData: FormData) => void | Promise<void>;
  paymentId: string;
  maskedCurrentEmail: string | null;
  wordDisplay: string;
}) {
  return (
    <div className="rounded border border-line bg-surface p-3 text-left">
      <p className="font-mono text-xs font-bold tracking-widest text-muted">🔔 GET NOTIFIED</p>
      <p className="mt-1 text-xs text-muted">
        {maskedCurrentEmail
          ? `An email (${maskedCurrentEmail}) is already set for this brand — enter yours below if you'd like to change it:`
          : `Optional — get an email if someone takes ${wordDisplay} from you later.`}
      </p>
      <form action={action} className="mt-2 flex gap-2">
        <input type="hidden" name="paymentId" value={paymentId} />
        <input
          type="email"
          name="email"
          placeholder="you@yourbrand.com"
          maxLength={200}
          className="w-full rounded border border-line bg-surface-2 px-2.5 py-2 text-sm placeholder:text-muted focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded border border-gold px-3 py-2 font-mono text-xs font-bold text-gold transition hover:bg-gold hover:text-ink"
        >
          {maskedCurrentEmail ? 'UPDATE' : 'NOTIFY ME'}
        </button>
      </form>
    </div>
  );
}
