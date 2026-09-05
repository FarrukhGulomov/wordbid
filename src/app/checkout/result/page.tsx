import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatUsd } from '@/lib/money';
import { getRank } from '@/lib/queries';
import { PendingRefresh } from '@/components/PendingRefresh';

export const dynamic = 'force-dynamic';

/**
 * Where the buyer lands after paying.
 *
 * The provider's redirect is NOT proof of payment — only the webhook is. So this page reads
 * the payment's real status and, while it is still PENDING, refreshes until the webhook lands.
 */
export default async function CheckoutResultPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment: paymentId } = await searchParams;
  if (!paymentId) notFound();

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { word: true, owner: true },
  });
  if (!payment) notFound();

  const wordDisplay = payment.word.display.toUpperCase();

  if (payment.status === 'CONFIRMED') {
    const rank = await getRank(payment.wordId);
    const shareText = `👑 We own "${wordDisplay}" on OwnTheInternet.`;
    const shareUrl = `/word/${payment.word.normalized}`;

    return (
      <div className="py-16 text-center">
        <p className="font-mono text-xs tracking-widest text-live">PAYMENT CONFIRMED</p>
        <h1 className="mt-3 font-mono text-3xl font-black tracking-tight sm:text-4xl">
          👑 YOU OWN {wordDisplay}
        </h1>
        <p className="mt-4 text-muted">
          {payment.owner.name} owns {wordDisplay} at{' '}
          <span className="font-bold text-gold">{formatUsd(payment.amountCents)}</span>
          {rank ? (
            <>
              {' '}
              — global rank <span className="font-bold text-text">#{rank}</span>.
            </>
          ) : (
            '.'
          )}
        </p>

        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-2">
          <Link
            href={shareUrl}
            className="rounded bg-gold px-4 py-2.5 font-mono text-sm font-bold text-ink transition hover:opacity-85"
          >
            SEE YOUR WORD PAGE
          </Link>
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line px-4 py-2.5 font-mono text-sm font-bold transition hover:border-muted"
          >
            SHARE IT
          </a>
          <Link href="/" className="mt-2 text-sm text-muted underline underline-offset-2">
            See the leaderboard
          </Link>
        </div>
      </div>
    );
  }

  if (payment.status === 'REFUNDED' || payment.status === 'REFUND_PENDING') {
    return (
      <div className="py-16 text-center">
        <p className="font-mono text-xs tracking-widest text-muted">WORD NOT WON</p>
        <h1 className="mt-3 font-mono text-2xl font-black tracking-tight sm:text-3xl">
          SOMEONE GOT {wordDisplay} FIRST
        </h1>
        <p className="mx-auto mt-4 max-w-md text-muted">
          {payment.failureReason ?? 'This word was taken before your payment completed.'}{' '}
          {payment.status === 'REFUNDED'
            ? 'Your payment has been refunded in full.'
            : 'Your refund is being processed and will be returned in full.'}
        </p>
        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-2">
          <Link
            href={`/claim?word=${encodeURIComponent(payment.word.normalized)}`}
            className="rounded bg-gold px-4 py-2.5 font-mono text-sm font-bold text-ink transition hover:opacity-85"
          >
            TAKE IT BACK
          </Link>
          <Link href="/" className="text-sm text-muted underline underline-offset-2">
            See the leaderboard
          </Link>
        </div>
      </div>
    );
  }

  if (payment.status === 'FAILED' || payment.status === 'CANCELED') {
    return (
      <div className="py-16 text-center">
        <h1 className="font-mono text-2xl font-black tracking-tight">PAYMENT NOT COMPLETED</h1>
        <p className="mt-4 text-muted">You were not charged. Nothing changed.</p>
        <Link
          href={`/claim?word=${encodeURIComponent(payment.word.normalized)}`}
          className="mt-8 inline-block rounded bg-gold px-4 py-2.5 font-mono text-sm font-bold text-ink transition hover:opacity-85"
        >
          TRY AGAIN
        </Link>
      </div>
    );
  }

  // PENDING: the provider has not confirmed yet.
  return (
    <div className="py-16 text-center">
      <h1 className="font-mono text-2xl font-black tracking-tight">CONFIRMING YOUR PAYMENT…</h1>
      <p className="mx-auto mt-4 max-w-md text-muted">
        We are waiting for your payment provider to confirm. Your rank updates the moment it does.
        This page refreshes on its own.
      </p>
      <PendingRefresh />
    </div>
  );
}
