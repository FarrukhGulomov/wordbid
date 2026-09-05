import crypto from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { getPaymentProvider, MockPaymentProvider } from '@/lib/payments';
import { formatUsd } from '@/lib/money';

export const dynamic = 'force-dynamic';

/**
 * Stand-in for a hosted checkout page, used only when PAYMENT_PROVIDER=mock.
 *
 * The buttons send a signed event to the real webhook endpoint, so local development
 * exercises exactly the same confirmation path as production.
 */

function mockProvider(): MockPaymentProvider {
  const provider = getPaymentProvider();
  if (!(provider instanceof MockPaymentProvider)) notFound();
  return provider;
}

/** Posts a signed event to our own webhook, then sends the buyer to the result page. */
async function sendMockEvent(paymentId: string, type: 'payment_succeeded' | 'payment_failed') {
  'use server';

  const provider = mockProvider();
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) notFound();

  const body = JSON.stringify({
    eventId: `evt_${crypto.randomUUID()}`,
    type,
    reference: payment.providerReference,
    amountCents: payment.amountCents,
  });

  const response = await fetch(`${config.siteUrl}/api/webhooks/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mock-signature': provider.sign(body) },
    body,
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Mock webhook rejected: ${response.status} ${await response.text()}`);
  }

  redirect(`/checkout/result?payment=${payment.id}`);
}

export default async function SandboxPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  mockProvider();

  const { payment: paymentId } = await searchParams;
  if (!paymentId) notFound();

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { word: true, owner: true },
  });
  if (!payment) notFound();

  if (payment.status !== 'PENDING') {
    redirect(`/checkout/result?payment=${payment.id}`);
  }

  const pay = sendMockEvent.bind(null, payment.id, 'payment_succeeded');
  const cancel = sendMockEvent.bind(null, payment.id, 'payment_failed');

  return (
    <div className="py-16">
      <div className="mx-auto max-w-md rounded border border-line bg-surface p-6">
        <p className="mb-4 rounded bg-gold/15 px-3 py-2 text-center font-mono text-xs text-gold">
          TEST CHECKOUT — no real card, no real money
        </p>

        <h1 className="font-mono text-lg font-bold">
          Own &ldquo;{payment.word.display.toUpperCase()}&rdquo;
        </h1>
        <dl className="mt-4 space-y-2 border-y border-line py-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Brand</dt>
            <dd className="font-medium">{payment.owner.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Destination</dt>
            <dd className="max-w-[60%] truncate font-mono text-xs">{payment.owner.url}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Total</dt>
            <dd className="tnum font-mono text-lg font-bold text-gold">
              {formatUsd(payment.amountCents)}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-muted">
          You are buying temporary placement on this platform. Not legal ownership of a word. Any
          brand can take it later by paying more. No results are guaranteed.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <form action={pay}>
            <button
              type="submit"
              className="w-full rounded bg-gold px-4 py-3 font-mono text-sm font-bold text-ink transition hover:opacity-85"
            >
              PAY {formatUsd(payment.amountCents)}
            </button>
          </form>
          <form action={cancel}>
            <button
              type="submit"
              className="w-full rounded border border-line px-4 py-2.5 font-mono text-sm text-muted transition hover:border-muted hover:text-text"
            >
              CANCEL
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
