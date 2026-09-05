import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getPaymentProvider } from '@/lib/payments';
import { confirmPayment, failPayment } from '@/lib/ownership';

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

  if (result.outcome === 'lost') {
    // The buyer paid but a competing takeover landed first. Return the money.
    try {
      await provider.refund(event.reference, result.amountCents);
      await prisma.payment.update({
        where: { id: result.paymentId },
        data: { status: 'REFUNDED', refundedAt: new Date() },
      });
    } catch (err) {
      // Leave the payment in REFUND_PENDING so it shows up in /admin for manual handling.
      console.error('webhook: refund failed for payment', result.paymentId, err);
    }
  }

  if (result.outcome === 'unknown_payment') {
    // Do not ask the provider to retry forever for a reference we will never recognise.
    console.warn('webhook: no payment for reference', event.reference);
    return NextResponse.json({ received: true, result: result.outcome });
  }

  return NextResponse.json({ received: true, result: result.outcome });
}
