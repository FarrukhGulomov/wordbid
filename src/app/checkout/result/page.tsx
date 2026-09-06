import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatUsd } from '@/lib/money';
import { getRank, isFirstClaimPayment } from '@/lib/queries';
import { config, SITE_NAME } from '@/lib/config';
import { PendingRefresh } from '@/components/PendingRefresh';
import { ShareButtons } from '@/components/ShareButtons';

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
  const isBoost = payment.kind === 'BOOST';

  if (payment.status === 'CONFIRMED') {
    const rank = await getRank(payment.wordId);
    const wordPath = `/word/${payment.word.normalized}`;
    // The canonical, absolute URL — this is what gets shared and copied, never the relative path.
    const canonicalUrl = `${config.siteUrl}${wordPath}`;
    // A first claim and a takeover/reclaim are different wins and get different copy — see
    // isFirstClaimPayment. Meaningless (and skipped) for a boost, which never creates its own
    // ownership.
    const isFirstClaim = isBoost ? false : await isFirstClaimPayment(payment.id);
    const shareText = isBoost
      ? `🚀 We boosted "${wordDisplay}" on ${SITE_NAME}.`
      : isFirstClaim
        ? `We own ${wordDisplay} on ${SITE_NAME} 👑`
        : `We just took ${wordDisplay} on ${SITE_NAME} 👑`;

    return (
      <div className="py-16 text-center">
        <p className="font-mono text-xs tracking-widest text-live">
          {isBoost ? 'BOOST CONFIRMED' : 'PAYMENT CONFIRMED'}
        </p>
        <h1 className="mt-3 font-mono text-3xl font-black tracking-tight sm:text-4xl">
          {isBoost
            ? `${wordDisplay} BOOSTED 🚀`
            : isFirstClaim
              ? `YOU OWN ${wordDisplay} 👑`
              : `YOU TOOK ${wordDisplay} 👑`}
        </h1>
        <p className="mt-4 text-lg">
          {isBoost
            ? `${payment.owner.name} paid ${formatUsd(payment.amountCents)} to raise ${wordDisplay}'s value.`
            : isFirstClaim
              ? `${payment.owner.name} now owns ${wordDisplay} on ${SITE_NAME}.`
              : `${payment.owner.name} took ${wordDisplay} on ${SITE_NAME}.`}
        </p>
        <p className="mt-1 text-sm text-muted">
          {/* A boost's amountCents is only the difference charged, not the resulting value —
              show the word's live (post-boost) value here instead. */}
          {formatUsd(isBoost ? payment.word.valueCents : payment.amountCents)}
          {rank ? (
            <>
              {' '}
              — global rank <span className="font-bold text-text">#{rank}</span>
            </>
          ) : null}
        </p>

        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-2">
          <Link
            href={wordPath}
            className="rounded bg-gold px-4 py-2.5 font-mono text-sm font-bold text-ink transition hover:opacity-85"
          >
            SEE YOUR WORD PAGE
          </Link>
          <ShareButtons shareText={shareText} canonicalUrl={canonicalUrl} />
          <Link href="/" className="mt-2 text-sm text-muted underline underline-offset-2">
            See the leaderboard
          </Link>
        </div>
      </div>
    );
  }

  if (payment.status === 'REFUNDED' || payment.status === 'REFUND_PENDING') {
    const retryPath = isBoost
      ? `/word/${payment.word.normalized}/analytics`
      : `/claim?word=${encodeURIComponent(payment.word.normalized)}`;
    return (
      <div className="py-16 text-center">
        <p className="font-mono text-xs tracking-widest text-muted">
          {isBoost ? 'BOOST DID NOT APPLY' : 'WORD NOT WON'}
        </p>
        <h1 className="mt-3 font-mono text-2xl font-black tracking-tight sm:text-3xl">
          {isBoost ? `${wordDisplay} WAS NOT BOOSTED` : `SOMEONE GOT ${wordDisplay} FIRST`}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-muted">
          {payment.failureReason ??
            (isBoost
              ? 'This word changed hands before your boost completed.'
              : 'This word was taken before your payment completed.')}{' '}
          {payment.status === 'REFUNDED'
            ? 'Your payment has been refunded in full.'
            : 'Your refund is being processed and will be returned in full.'}
        </p>
        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-2">
          <Link
            href={retryPath}
            className="rounded bg-gold px-4 py-2.5 font-mono text-sm font-bold text-ink transition hover:opacity-85"
          >
            {isBoost ? 'SEE THE WORD PAGE' : 'TAKE IT BACK'}
          </Link>
          <Link href="/" className="text-sm text-muted underline underline-offset-2">
            See the leaderboard
          </Link>
        </div>
      </div>
    );
  }

  if (payment.status === 'FAILED' || payment.status === 'CANCELED') {
    const retryPath = isBoost
      ? `/word/${payment.word.normalized}/analytics`
      : `/claim?word=${encodeURIComponent(payment.word.normalized)}`;
    return (
      <div className="py-16 text-center">
        <h1 className="font-mono text-2xl font-black tracking-tight">PAYMENT NOT COMPLETED</h1>
        <p className="mt-4 text-muted">You were not charged. Nothing changed.</p>
        <Link
          href={retryPath}
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
