import type { Metadata } from 'next';
import Link from 'next/link';
import { formatUsd, formatCount } from '@/lib/money';
import { getMetrics } from '@/lib/metrics';
import { getLeaderboard } from '@/lib/queries';
import { getOnlineCount, getTotalVisitors, getHourlyVisitors, getMostClickedWords } from '@/lib/attention';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Stats',
  description: 'Real, public numbers: visitors, online now, outbound clicks, and the words getting the most attention.',
};

/**
 * The public "attention proof" page — real numbers only, nothing estimated or seeded. See
 * src/lib/attention.ts for exactly how each one is defined and counted.
 *
 * Deliberately small: no geography, device, referrer or CTR breakdowns. Those are owner-only
 * analytics for later, not part of this page.
 */
export default async function StatsPage() {
  const [online, visitors, hourly, mostClicked, mostValuable, metrics] = await Promise.all([
    getOnlineCount(),
    getTotalVisitors(),
    getHourlyVisitors(24),
    getMostClickedWords(5),
    getLeaderboard(5),
    getMetrics(),
  ]);

  const maxHourly = Math.max(1, ...hourly.map((h) => h.count));

  const tiles: [string, string][] = [
    ['VISITORS', formatCount(visitors)],
    ['ONLINE NOW', formatCount(online)],
    ['OUTBOUND CLICKS', formatCount(metrics.outboundClicks)],
    ['WORDS OWNED', formatCount(metrics.claimedWords)],
    ['TAKEOVERS', formatCount(metrics.takeovers)],
  ];

  return (
    <div className="py-10">
      <h1 className="font-mono text-2xl font-black tracking-tight sm:text-3xl">WORDBID STATS</h1>
      <p className="mt-2 text-sm text-muted">
        Real numbers only. <span className="text-live">🟢 Online</span> = active in the last 5
        minutes. Visitors = distinct real browsers ever seen — never estimated.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded border border-line bg-surface px-3 py-3">
            <dt className="font-mono text-[10px] tracking-widest text-muted">{label}</dt>
            <dd className="tnum mt-1 font-mono text-2xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-10">
        <h2 className="mb-3 font-mono text-xs font-bold tracking-widest text-muted">
          VISITORS — LAST 24 HOURS
        </h2>
        <div className="flex h-32 items-end gap-[3px] rounded border border-line bg-surface p-3">
          {hourly.map((h) => (
            <div
              key={h.hour.toISOString()}
              title={`${h.count} visitor${h.count === 1 ? '' : 's'} — ${h.hour.toLocaleTimeString([], { hour: '2-digit' })}`}
              className="flex-1 rounded-t bg-gold/70 transition hover:bg-gold"
              style={{ height: `${Math.max(4, (h.count / maxHourly) * 100)}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>24h ago</span>
          <span>now</span>
        </div>
      </section>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">
            MOST CLICKED WORDS
          </h2>
          {mostClicked.length === 0 ? (
            <p className="text-sm text-muted">No clicks yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {mostClicked.map((word) => (
                <li key={word.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <Link
                      href={`/word/${word.normalized}`}
                      className="font-mono font-bold uppercase hover:text-gold"
                    >
                      {word.display}
                    </Link>{' '}
                    <span className="text-xs text-muted">
                      {word.currentOwnership?.owner.name}
                    </span>
                  </span>
                  <span className="tnum shrink-0 font-mono text-xs text-muted">
                    {formatCount(word.clickCount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">
            MOST VALUABLE
          </h2>
          {mostValuable.length === 0 ? (
            <p className="text-sm text-muted">Nobody owns anything yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {mostValuable.map((row) => (
                <li key={row.wordId} className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/word/${row.normalized}`}
                    className="truncate font-mono font-bold uppercase hover:text-gold"
                  >
                    {row.display}
                  </Link>
                  <span className="tnum shrink-0 font-mono text-xs text-gold">
                    {formatUsd(row.valueCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="mt-10 text-sm">
        <Link href="/" className="text-muted underline underline-offset-2 hover:text-text">
          ← See who owns the internet
        </Link>
      </p>
    </div>
  );
}
