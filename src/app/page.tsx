import Link from 'next/link';
import { LeaderboardRow } from '@/components/LeaderboardRow';
import { ActivityFeed } from '@/components/ActivityFeed';
import { WordSearch } from '@/components/WordSearch';
import { ImpressionBeacon } from '@/components/ImpressionBeacon';
import { getLeaderboard, getRecentActivity, getMostFoughtOver } from '@/lib/queries';
import { getTrendingWords, getRisingWords, getHiddenGems, getNewArrivals } from '@/lib/discovery';
import { formatUsd } from '@/lib/money';
import { config } from '@/lib/config';

// The leaderboard is the product; it must never be served stale.
export const dynamic = 'force-dynamic';

type Tab = 'top' | 'trending' | 'rising' | 'gems' | 'new';

const TABS: { key: Tab; label: string }[] = [
  { key: 'top', label: '🏆 Top' },
  { key: 'trending', label: '🔥 Trending' },
  { key: 'rising', label: '🚀 Rising' },
  { key: 'gems', label: '💎 Hidden Gems' },
  { key: 'new', label: '🆕 New' },
];

/**
 * Five views over one dataset (src/lib/discovery.ts) — never five parallel systems. Only `top`
 * is driven by payment; the other four are earned, real-data-only, and simply empty (never
 * fabricated) when there isn't yet enough activity to honestly back them.
 */
const TAB_COPY: Record<Tab, { description: string; empty: string }> = {
  top: {
    description:
      'Ranked by what the current owner paid. Pay more than the owner and the word is yours. Ties go to the earlier confirmed bid.',
    empty: 'Nobody owns anything yet.',
  },
  trending: {
    description: 'Real, recent clicks — never just payment. Moves as visitors actually click through.',
    empty: 'Nothing trending yet — check back once more visitors start clicking through.',
  },
  rising: {
    description: 'Climbing the leaderboard fastest, measured against where each word stood a week or two ago.',
    empty: "Rank history is still building. Check back in a few days to see who's climbing.",
  },
  gems: {
    description: 'Strong real engagement despite modest spend — not something a bigger bid can buy.',
    empty: 'No hidden gems yet — this needs enough real visits to find one honestly.',
  },
  new: {
    description: 'Most recently claimed, most recent first — never gated by payment amount.',
    empty: 'Nobody owns anything yet.',
  },
};

function isTab(value: string | undefined): value is Tab {
  return value === 'top' || value === 'trending' || value === 'rising' || value === 'gems' || value === 'new';
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab: Tab = isTab(rawTab) ? rawTab : 'top';

  const [rows, activity, contested] = await Promise.all([
    tab === 'top'
      ? getLeaderboard(50)
      : tab === 'trending'
        ? getTrendingWords(20)
        : tab === 'rising'
          ? getRisingWords(20)
          : tab === 'gems'
            ? getHiddenGems(20)
            : getNewArrivals(20),
    getRecentActivity(6),
    getMostFoughtOver(6),
  ]);

  const copy = TAB_COPY[tab];

  return (
    <>
      <ImpressionBeacon words={rows.map((row) => row.normalized)} />

      <section className="py-4 text-center sm:py-6">
        <h1 className="font-mono text-2xl font-black tracking-tighter sm:text-4xl">
          SEE WHO&apos;S GETTING ATTENTION ON THE INTERNET
        </h1>
        <p className="mt-1.5 text-sm text-text sm:text-base">
          Rank is bought. Attention is real — see who&apos;s actually getting clicked and visited.
        </p>
        <p className="text-xs text-muted">Every word has one owner. Until someone takes it.</p>

        <div className="mx-auto mt-3 max-w-md sm:mt-4">
          <WordSearch />
          <p className="mt-1.5 text-xs text-muted">
            Unclaimed words start at {formatUsd(config.startingPriceCents)}. Owned words cost{' '}
            {config.takeoverIncrementPercent}% more than the current price.
          </p>
        </div>

        <p className="mt-2 text-xs">
          <Link href="/claim" className="text-muted underline underline-offset-2 hover:text-text">
            Have a startup? Compete for attention →
          </Link>
        </p>
      </section>

      <section>
        {/* -mx-4 px-4 bleeds the scroll area to the true screen edge on mobile (canceling
            <main>'s own px-4) so the last tab gets real trailing space instead of stopping flush
            against the container's inner edge, where it reads as clipped rather than scrollable.
            Reverts to normal, non-bled padding at sm+ where the tabs already fit without scrolling. */}
        <nav
          className="-mx-4 mb-3 flex gap-1 overflow-x-auto px-4 border-b border-line sm:mx-0 sm:px-0"
          aria-label="Discovery views"
        >
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === 'top' ? '/' : `/?tab=${t.key}`}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 font-mono text-xs font-bold tracking-widest transition ${
                tab === t.key
                  ? 'border-gold text-gold'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <p className="mb-3 text-xs text-muted">{copy.description}</p>

        {rows.length === 0 ? (
          <div className="rounded border border-dashed border-line px-6 py-12 text-center">
            <p className="font-mono text-base font-bold">{copy.empty}</p>
            {(tab === 'top' || tab === 'new') && (
              <>
                <p className="mt-2 text-sm text-muted">
                  The first word claimed becomes #1 on the internet.
                </p>
                <Link
                  href="/claim"
                  className="mt-5 inline-block rounded bg-gold px-4 py-2 font-mono text-sm font-bold text-ink transition hover:opacity-85"
                >
                  CLAIM THE FIRST WORD
                </Link>
              </>
            )}
          </div>
        ) : (
          <ul className="border-t border-line">
            {rows.map((row) => (
              <LeaderboardRow key={row.wordId} row={row} />
            ))}
          </ul>
        )}
      </section>

      <ActivityFeed entries={activity} />

      {contested.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">
            🔥 MOST FOUGHT OVER
          </h2>
          <ul className="space-y-1 text-sm">
            {contested.map(({ word, takeovers }) => (
              <li key={word.id} className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/word/${word.normalized}`}
                  className="truncate font-mono font-bold uppercase hover:text-gold"
                >
                  {word.display}
                </Link>
                <span className="tnum shrink-0 text-xs text-muted">
                  {takeovers} takeover{takeovers === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
