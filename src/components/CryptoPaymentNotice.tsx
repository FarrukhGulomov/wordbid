/**
 * Shown only when checkout is currently routed to a crypto payment provider (see
 * config.isCryptoPayment) — never for card/mock checkout. A plain inline notice, not a modal:
 * WordBid has no interstitial dialogs anywhere in its checkout flow, and this does not start
 * being the exception.
 *
 * This is disclosure, not verification — it does not check age or eligibility itself, and does
 * not stand in for whatever KYC/eligibility checks the payment provider applies on its own
 * hosted page. It exists so that requirement is stated before the buyer leaves WordBid.
 */
export function CryptoPaymentNotice() {
  return (
    <div className="rounded border border-line bg-surface-2 p-3 text-xs text-muted">
      <p className="mb-1 font-bold text-text">Crypto payments — 18+ only</p>
      <p>
        By continuing, you confirm that you meet the age and eligibility requirements applicable
        to the payment service in your jurisdiction. The payment provider may apply its own
        identity or eligibility checks before completing payment.
      </p>
    </div>
  );
}
