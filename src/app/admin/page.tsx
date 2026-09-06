import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ADMIN_COOKIE, isAdmin, isValidAdminToken } from '@/lib/admin';
import { formatUsd, formatCount, formatPercent } from '@/lib/money';
import { getMetrics } from '@/lib/metrics';
import { adminActionSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/ratelimit';
import { clientIpFrom } from '@/lib/clicks';
import { reconcileRefund, reconcileAllPendingRefunds } from '@/lib/refunds';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Exchanges the admin token for an httpOnly session cookie.
 *
 * Rate limited per IP so the token cannot be brute-forced by hammering this form — the
 * constant-time comparison in isValidAdminToken only protects against a timing side-channel,
 * not against sheer guess volume.
 */
async function signIn(formData: FormData) {
  'use server';

  const ip = clientIpFrom(await headers());
  const limited = rateLimit(`admin-signin:${ip}`, 5, 10 * 60_000);
  if (!limited.ok) return;

  const token = String(formData.get('token') ?? '');
  if (!isValidAdminToken(token)) return;

  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/admin',
    maxAge: 60 * 60 * 8,
  });
  revalidatePath('/admin');
}

/**
 * Moderation actions.
 *
 * Blocking hides a word or owner from every public surface immediately. Money is never moved
 * from here — refunds are issued through the payment provider.
 */
async function moderate(formData: FormData) {
  'use server';
  if (!(await isAdmin())) throw new Error('Not authorised');

  const parsed = adminActionSchema.safeParse({
    action: formData.get('action'),
    id: formData.get('id'),
  });
  if (!parsed.success) throw new Error('Invalid moderation request');
  const { action, id } = parsed.data;

  if (action === 'block_word') {
    await prisma.word.update({ where: { id }, data: { blocked: true } });
  } else if (action === 'unblock_word') {
    await prisma.word.update({ where: { id }, data: { blocked: false } });
  } else if (action === 'block_owner') {
    // Suspending a brand also pulls every word it currently holds off the leaderboard.
    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id }, data: { blocked: true } });
      const held = await tx.ownership.findMany({
        where: { ownerId: id, endedAt: null },
        select: { wordId: true },
      });
      if (held.length > 0) {
        await tx.word.updateMany({
          where: { id: { in: held.map((o) => o.wordId) } },
          data: { blocked: true },
        });
      }
    });
  }

  revalidatePath('/admin');
  revalidatePath('/');
}

/** Retries the refund for one stuck payment. Safe to click more than once. */
async function retryRefund(formData: FormData) {
  'use server';
  if (!(await isAdmin())) throw new Error('Not authorised');
  const paymentId = String(formData.get('paymentId') ?? '');
  if (!paymentId) throw new Error('Missing paymentId');
  await reconcileRefund(paymentId);
  revalidatePath('/admin');
}

/** Retries every payment currently stuck REFUND_PENDING. */
async function retryAllRefunds() {
  'use server';
  if (!(await isAdmin())) throw new Error('Not authorised');
  await reconcileAllPendingRefunds();
  revalidatePath('/admin');
}

export default async function AdminPage() {
  if (!(await isAdmin())) {
    return (
      <div className="py-16">
        <form action={signIn} className="mx-auto max-w-sm space-y-3">
          <h1 className="font-mono text-lg font-bold">ADMIN</h1>
          <input
            type="password"
            name="token"
            placeholder="Admin token"
            required
            className="w-full rounded border border-line bg-surface px-3 py-2.5 focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            className="w-full rounded bg-gold px-4 py-2.5 font-mono text-sm font-bold text-ink"
          >
            SIGN IN
          </button>
        </form>
      </div>
    );
  }

  const [words, needsAttention, metrics] = await Promise.all([
    prisma.word.findMany({
      where: { currentOwnershipId: { not: null } },
      orderBy: { valueCents: 'desc' },
      take: 100,
      include: { currentOwnership: { include: { owner: true } } },
    }),
    prisma.payment.findMany({
      where: { status: 'REFUND_PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { word: true, owner: true },
    }),
    getMetrics(),
  ]);

  const tiles: [string, string][] = [
    ['REVENUE', formatUsd(metrics.revenueCents)],
    ['PAYMENTS', formatCount(metrics.confirmedPayments)],
    ['CLAIMED WORDS', formatCount(metrics.claimedWords)],
    ['PAID PLACEMENTS', formatCount(metrics.payingOwners)],
    ['TAKEOVERS', formatCount(metrics.takeovers)],
    ['REPEAT BUYERS', formatCount(metrics.repeatBuyers)],
    ['OUTBOUND CLICKS', formatCount(metrics.outboundClicks)],
    ['AVG OWNERSHIP', formatUsd(metrics.averageOwnershipValueCents)],
    ['BOOST SPEND', formatUsd(metrics.boostSpendCents)],
    ['COMPETITIVE SPEND', formatUsd(metrics.competitiveSpendCents)],
    ['REPEAT BUYER RATE', formatPercent(metrics.repeatBuyerRate)],
    ['WORD COMPETITION RATE', formatPercent(metrics.wordCompetitionRate)],
    ['COMPETITIVE REVENUE SHARE', formatPercent(metrics.competitiveRevenueShare)],
  ];

  return (
    <div className="py-10">
      <h1 className="font-mono text-lg font-bold">ADMIN</h1>

      <section className="mt-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded border border-line bg-surface px-3 py-2.5">
              <dt className="font-mono text-[10px] tracking-widest text-muted">{label}</dt>
              <dd className="tnum mt-0.5 font-mono text-lg font-bold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">
          Visitors, claim conversion and referral traffic are not shown here — they need a web
          analytics tool. See README for how to add one.
        </p>
      </section>

      {needsAttention.length > 0 && (
        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-mono text-xs font-bold tracking-widest text-gold">
              REFUNDS NEEDING ATTENTION
            </h2>
            <form action={retryAllRefunds}>
              <button
                type="submit"
                className="rounded border border-gold/60 px-2 py-1 font-mono text-[11px] text-gold hover:bg-gold/10"
              >
                RETRY ALL
              </button>
            </form>
          </div>
          <p className="mb-2 text-xs text-muted">
            Money was captured but the word was not won. Retry asks the payment provider to
            refund it again — safe to click more than once. If it keeps failing, refund it
            directly in your payment provider&rsquo;s dashboard.
          </p>
          <ul className="divide-y divide-line rounded border border-gold/40">
            {needsAttention.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono">{payment.providerReference}</span> ·{' '}
                  {formatUsd(payment.amountCents)} · {payment.owner.name} ·{' '}
                  {payment.word.display.toUpperCase()}
                </span>
                <form action={retryRefund}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <button
                    type="submit"
                    className="rounded border border-line px-2 py-1 font-mono text-[11px] hover:border-muted"
                  >
                    RETRY
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">
          OWNED WORDS
        </h2>
        <ul className="divide-y divide-line rounded border border-line">
          {words.map((word) => (
            <li key={word.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Link
                href={`/word/${word.normalized}`}
                className="font-mono font-bold uppercase hover:text-gold"
              >
                {word.display}
              </Link>
              <span className="tnum text-gold">{formatUsd(word.valueCents)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">
                {word.currentOwnership?.owner.name} — {word.currentOwnership?.owner.url}
              </span>
              {word.blocked && <span className="font-mono text-xs text-gold">BLOCKED</span>}

              <form action={moderate} className="flex gap-1">
                <input type="hidden" name="id" value={word.id} />
                <button
                  type="submit"
                  name="action"
                  value={word.blocked ? 'unblock_word' : 'block_word'}
                  className="rounded border border-line px-2 py-1 font-mono text-[11px] hover:border-muted"
                >
                  {word.blocked ? 'UNBLOCK' : 'BLOCK WORD'}
                </button>
              </form>
              <form action={moderate}>
                <input type="hidden" name="id" value={word.currentOwnership?.ownerId ?? ''} />
                <button
                  type="submit"
                  name="action"
                  value="block_owner"
                  className="rounded border border-line px-2 py-1 font-mono text-[11px] hover:border-muted"
                >
                  BLOCK BRAND
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
