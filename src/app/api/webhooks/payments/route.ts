import { NextResponse } from 'next/server';
import { getPaymentProvider } from '@/lib/payments';
import { confirmPayment, failPayment } from '@/lib/ownership';
import { reconcileRefund } from '@/lib/refunds';
import { getNotificationProvider } from '@/lib/notifications';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The only entry point that can change ownership and therefore ranking.
 *
 * Contract:
 *   - The signature is verified against the RAW body. An unverified request is rejected 400.
 *   - Applying an event is idempotent; a redelivery is acknowledged and changes nothing.
 *   - A captured payment that lost the word is refunded, never silently kept.
 *   - Any 2xx tells the provider to stop retrying, so we only 2xx once the work is durable.
 */
export async function POST(request: Request) {
  const provider = getPaymentProvider();

  // Must read the body as text — a re-serialised object would not match the signature.
  const rawBody = await request.text();

  let event;
  try {
    event = await provider.verifyWebhook(rawBody, request.headers);
  } catch (err) {
    console.error('webhook: signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.kind === 'ignored') {
    return NextResponse.json({ received: true, handled: false });
  }

  if (event.kind === 'payment_failed') {
    const result = await failPayment(provider.name, event.eventId, event.reference);
    return NextResponse.json({ received: true, result });
  }

  const result = await confirmPayment(provider.name, event.eventId, event.reference);

  if (result.outcome === 'won' && result.notification) {
    // Best-effort, outside the payment transaction: a notification failure must never look like
    // a payment failure, and must never retry the whole webhook (which would just re-attempt an
    // already-applied ownership change). See src/lib/notifications for the provider contract.
    try {
      await getNotificationProvider().sendTakeoverNotice(result.notification);
    } catch (err) {
      console.error('webhook: takeover notification failed', err);
    }
  }

  if (result.outcome === 'lost') {
    // The buyer paid but a competing takeover landed first. Return the money now. If this
    // fails, the payment stays REFUND_PENDING — surfaced in /admin and retried by
    // `npm run reconcile-refunds`, so a dead process here never leaves it stuck silently.
    const refund = await reconcileRefund(result.paymentId);
    if (refund.outcome === 'failed') {
      console.error('webhook: refund failed for payment', result.paymentId, refund.error);
    }
  }

  if (result.outcome === 'unknown_payment') {
    // Do not ask the provider to retry forever for a reference we will never recognise — but
    // this is real captured money the provider says arrived with nothing on our side to apply it
    // to (see F02), so it must not just scroll away in logs. confirmPayment already created this
    // exact WebhookEvent row (provider, eventId) as its own idempotency guard, before it ever
    // looked for a matching payment — flag that same row so it surfaces in /admin rather than
    // relying on whoever operates this deployment to notice a console line.
    console.error('webhook: no payment for reference — needs manual attention', event.reference);
    await prisma.webhookEvent
      .update({
        where: { provider_eventId: { provider: provider.name, eventId: event.eventId } },
        data: { providerReference: event.reference, needsAttention: 'unknown_payment' },
      })
      .catch((err) => {
        // Best-effort: the payment itself is unaffected either way, and this must never turn an
        // already-successful webhook response into a failure the provider would just retry.
        console.error('webhook: failed to flag unknown_payment WebhookEvent for admin review', err);
      });
    return NextResponse.json({ received: true, result: result.outcome });
  }

  return NextResponse.json({ received: true, result: result.outcome });
}
