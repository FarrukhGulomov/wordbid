import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getWordByNormalized } from '@/lib/queries';
import { getOwnershipPerformance, calculateCostPerClickCents } from '@/lib/ownership-stats';
import { normalizeWord } from '@/lib/word';
import { formatUsd, formatCount } from '@/lib/money';
import { shortDate } from '@/lib/time';
import { SITE_NAME } from '@/lib/config';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ word: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { word: raw } = await params;
  const normalized = normalizeWord(decodeURIComponent(raw));
  const word = await getWordByNormalized(normalized);
  const display = (word?.display ?? normalized).toUpperCase();

  return {
    title: `${display} — Ownership performance`,
    description: word?.currentOwnership
      ? `Real impressions, clicks and CTR for ${word.currentOwnership.owner.name}'s current ownership of "${display}" on ${SITE_NAME}.`
      : `Ownership performance for "${display}" on ${SITE_NAME}.`,
    robots: { index: false, follow: true },
  };
}

/**
 * Public "OWNERSHIP PERFORMANCE" view — no login, because there is none in this product. This
 * shows the CURRENT ownership only (never mixes in a previous owner's numbers), which is the
 * same rule the word page and leaderboard already follow.
 *
 * Deliberately performance-only: raising your own rank (BOOST) lives on the word page, not
 * here — "what did I get" and "want more visibility" are different decisions with different
 * moments, and mixing the two turned this page into an accidental checkout flow.
 */
export default async function OwnershipAnalyticsPage({ params }: Props) {
  const { word: raw } = await params;
  const normalized = normalizeWord(decodeURIComponent(raw));
  if (!normalized) notFound();

  const word = await getWordByNormalized(normalized);
  if (!word || !word.currentOwnership) notFound();

  const performance = await getOwnershipPerformance(word.currentOwnership.id);
  if (!performance) notFound();

  const display = word.display.toUpperCase();
  const owner = word.currentOwnership.owner;
  const cpc = calculateCostPerClickCents(performance.amountCents, performance.validClicks);

  const stats: [string, string][] = [
    ['RANK', word.rank ? `#${word.rank}` : 'UNRANKED'],
    ['IMPRESSIONS', formatCount(performance.impressions)],
    ['CLICKS DELIVERED', formatCount(performance.validClicks)],
    ['CTR', `${performance.ctr.toFixed(1)}%`],
    ['COST / CLICK', cpc === null ? '—' : formatUsd(cpc)],
  ];

  return (
    <div className="py-10">
      <p className="font-mono text-xs tracking-widest text-muted">OWNERSHIP PERFORMANCE</p>
      <h1 className="mt-1 font-mono text-3xl font-black uppercase tracking-tighter sm:text-4xl">
        {display}
      </h1>
      <p className="mt-1 text-sm text-muted">Current owner: {owner.name}</p>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded border border-line bg-surface p-4 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="font-mono text-xs text-muted">{label}</dt>
            <dd className="tnum font-mono text-xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">Started {shortDate(performance.startedAt)}</p>

      <section className="mt-8">
        <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">TRAFFIC</h2>
        <ul className="divide-y divide-line rounded border border-line text-sm">
          <li className="flex items-center justify-between px-3 py-2.5">
            <span className="text-muted">Today</span>
            <span className="tnum font-mono font-bold">
              {formatCount(performance.todayClicks)} clicks
            </span>
          </li>
          <li className="flex items-center justify-between px-3 py-2.5">
            <span className="text-muted">Last 7 days</span>
            <span className="tnum font-mono font-bold">
              {formatCount(performance.last7DaysClicks)} clicks
            </span>
          </li>
        </ul>
      </section>

      {performance.topReferrers.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">
            TOP REFERRERS
          </h2>
          <ul className="divide-y divide-line rounded border border-line text-sm">
            {performance.topReferrers.map((r) => (
              <li key={r.referrer} className="flex items-center justify-between px-3 py-2.5">
                <span>{r.referrer}</span>
                <span className="tnum font-mono text-muted">{formatCount(r.count)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-10 text-sm">
        <Link
          href={`/word/${word.normalized}`}
          className="text-muted underline underline-offset-2 hover:text-text"
        >
          ← Back to {display}
        </Link>
        {word.rank && word.rank > 1 && (
          <>
            {' · '}
            {/* A plain link, deliberately never a BOOST button — see "Design: performance vs.
                the purchase decision" in the README for why that mixing was removed from here. */}
            <Link
              href={`/word/${word.normalized}#boost`}
              className="text-muted underline underline-offset-2 hover:text-text"
            >
              Want to rank higher? →
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
