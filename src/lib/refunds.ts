import { prisma } from './db';
import { getPaymentProviderByName } from './payments';

/**
 * Refund reconciliation.
 *
 * `confirmPayment` marks a losing payment REFUND_PENDING and the webhook handler then calls
 * the provider's refund API in the same request. If the process dies between those two steps
 * — or the provider call itself fails — the payment is stuck REFUND_PENDING with real captured
 * money behind it. This is the retry path for that: safe to call repeatedly (a payment that is
 * no longer REFUND_PENDING is silently skipped), and it is what both the admin "Retry refund"
 * button and the `npm run reconcile-refunds` script call.
 */

export type RefundResult =
  | { paymentId: string; outcome: 'refunded' }
  // The provider accepted the refund but has not yet confirmed the money moved — see F06. The
  // payment stays REFUND_PENDING and a later reconciliation run checks again.
  | { paymentId: string; outcome: 'pending' }
  | { paymentId: string; outcome: 'skipped' }
  | { paymentId: string; outcome: 'failed'; error: string };

/** Attempts the refund for one payment. Never throws — failures are reported, not thrown. */
export async function reconcileRefund(paymentId: string): Promise<RefundResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== 'REFUND_PENDING') {
    return { paymentId, outcome: 'skipped' };
  }

  try {
    // The SAME provider that captured this payment — never whichever one happens to be
    // configured right now (see F09). An operator migrating PAYMENT_PROVIDER must not have
    // older payments' refunds silently misrouted to a provider that has never heard of them.
    const provider = getPaymentProviderByName(payment.provider);
    const status = await provider.refund(payment.providerReference, payment.amountCents);
    if (status === 'pending') {
      return { paymentId, outcome: 'pending' };
    }
    // Only flip to REFUNDED if it is still REFUND_PENDING — guards against a concurrent
    // reconciliation run doing the same work.
    await prisma.payment.updateMany({
      where: { id: payment.id, status: 'REFUND_PENDING' },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });
    return { paymentId, outcome: 'refunded' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('reconcileRefund: refund failed for payment', paymentId, err);
    return { paymentId, outcome: 'failed', error: message };
  }
}

/** Retries every payment currently stuck REFUND_PENDING. Intended for a periodic job. */
export async function reconcileAllPendingRefunds(): Promise<RefundResult[]> {
  const pending = await prisma.payment.findMany({
    where: { status: 'REFUND_PENDING' },
    select: { id: true },
  });
  const results: RefundResult[] = [];
  // Sequential, not Promise.all — this hits a real payment provider, and pending refunds
  // are rare, so there is no reason to burst calls at it.
  for (const payment of pending) {
    results.push(await reconcileRefund(payment.id));
  }
  return results;
}
