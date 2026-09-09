import Link from 'next/link';
import { LeaderboardRow } from '@/components/LeaderboardRow';
import { ActivityFeed } from '@/components/ActivityFeed';
import { WordSearch } from '@/components/WordSearch';
import { ImpressionTracker } from '@/components/ImpressionTracker';
import { getLeaderboard, getRecentActivity, getMostFoughtOver, countOwnedWords } from '@/lib/queries';
import { getTrendingWords, getRisingWords, getHiddenGems, getNewArrivals } from '@/lib/discovery';
import { formatUsd } from '@/lib/money';
import { config } from '@/lib/config';

// The leaderboard is the product; it must never be served stale.
export const dynamic = 'force-dynamic';

type Tab = 'top' | 'trending' | 'rising' | 'gems' | 'new' | 'active';

const TABS: { key: Tab; label: string }[] = [
  { key: 'top', label: '🏆 Top' },
  { key: 'trending', label: '🔥 Trending' },
  { key: 'rising', label: '🚀 Rising' },
  { key: 'gems', label: '💎 Hidden Gems' },
  { key: 'new', label: '🆕 New' },
  { key: 'active', label: '⚡ Active' },
];

/**
 * Six views over one dataset — never six parallel systems. Only `top` is driven by payment; the
 * rest are earned, real-data-only, and simply empty (never fabricated) when there isn't yet
 * enough activity to honestly back them. `active` is the one exception to "a leaderboard view":
 * it reuses the SAME Activity rows the homepage's own LIVE strip and confirmPayment already
 * write (src/lib/queries.ts#getRecentActivity) — a real event log, not a fifth ranking.
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
  active: {
    description: 'Every real claim, takeover, reclaim and boost, most recent first — rank is not the whole story.',
    empty: 'No activity yet — be the first to claim a word.',
  },
};

function isTab(value: string | undefined): value is Tab {
  return (
    value === 'top' ||
    value === 'trending' ||
    value === 'rising' ||
    value === 'gems' ||
    value === 'new' ||
    value === 'active'
  );
}

// F15: the Top view is the one real, unbounded ranking (every owned word competes on it) — the
// others are curated top-20 lists over a scored subset, not something a visitor pages through.
const TOP_PAGE_SIZE = 50;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { tab: rawTab, page: rawPage } = await searchParams;
  const tab: Tab = isTab(rawTab) ? rawTab : 'top';
  const parsedPage = Number(rawPage);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [rows, activity, contested, activeFeed, totalOwnedWords] = await Promise.all([
    tab === 'top'
      ? getLeaderboard(TOP_PAGE_SIZE, (page - 1) * TOP_PAGE_SIZE)
      : tab === 'trending'
        ? getTrendingWords(20)
        : tab === 'rising'
          ? getRisingWords(20)
          : tab === 'gems'
            ? getHiddenGems(20)
            : tab === 'new'
              ? getNewArrivals(20)
              : Promise.resolve([]), // 'active' renders activeFeed below, not a LeaderboardRow list
    getRecentActivity(6),
    getMostFoughtOver(6),
    tab === 'active' ? getRecentActivity(30) : Promise.resolve([]),
    tab === 'top' ? countOwnedWords() : Promise.resolve(0),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalOwnedWords / TOP_PAGE_SIZE));

  const copy = TAB_COPY[tab];

  return (
    <>
      <section className="py-4 text-center sm:py-6">
        <h1 className="font-mono text-2xl font-black tracking-tighter sm:text-4xl">
          SEE WHO&apos;S GETTING ATTENTION ON THE INTERNET
        </h1>
        <p className="mt-1.5 text-sm text-text sm:text-base">
          Rank is bought. Attention is real — see who&apos;s actually getting clicked and visited.
        </p>
        <p className="text-xs text-muted">Every word has one owner. Until someone takes it.</p>

        {/* CGPT-F09: the headline is written for a VISITOR ("see who's getting attention"), but
            the box directly under it is the CLAIM flow — typing a word here and pressing CLAIM
            starts a real checkout, not a search. Nothing on the page said so, and someone just
            browsing could easily read this input as "look something up". This line states both
            jobs explicitly and points each at what actually does that job: the board below for
            browsing, this box only for claiming. */}
        <p className="mt-2 text-xs text-muted">
          <span className="text-text">Browsing?</span> Scroll down to explore the board.{' '}
          <span className="text-text">Have a brand?</span> Claim a word below.
        </p>

        <div className="mx-auto mt-3 max-w-md sm:mt-4">
          <WordSearch />
          <p className="mt-1.5 text-xs text-muted">
            Unclaimed words start at {formatUsd(config.startingPriceCents)}. Owned words cost{' '}
            {config.takeoverIncrementPercent}% more than the current price.
          </p>
        </div>

        <p className="mt-2 text-xs">
          <Link href="/claim" className="inline-flex min-h-8 items-center text-muted underline underline-offset-2 hover:text-text">
            Have a startup? Compete for attention →
          </Link>
        </p>
      </section>

      <section>
        {/* -mx-4 px-4 bleeds the scroll area to the true screen edge on mobile (canceling
            <main>'s own px-4) so the last tab gets real trailing space instead of stopping flush
            against the container's inner edge, where it reads as clipped rather than scrollable.
            Reverts to normal, non-bled padding at sm+ where the tabs already fit without scrolling.

            The fade is the scroll affordance: at 390px only "Top" and "Rising" fit, and with the
            row ending in a hard edge there was nothing to say the other three tabs — Hidden Gems,
            New, Active — existed at all. Softening the right edge is what makes them discoverable.
            It stops a pixel short of the bottom so the nav's own border still reads as continuous,
            and it is pointer-events-none so it never eats a tap on the tab underneath. */}
        <div className="relative -mx-4 mb-3 sm:mx-0">
          <nav
            className="flex gap-1 overflow-x-auto px-4 border-b border-line sm:px-0"
            aria-label="Discovery views"
          >
            {/* CGPT-F05: the active tab was only marked by colour — a screen reader had no way to
                tell which of the five views it was already on. aria-current="page" is the
                standard signal for "this link is the current page/view within a nav". */}
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={t.key === 'top' ? '/' : `/?tab=${t.key}`}
                aria-current={tab === t.key ? 'page' : undefined}
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
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 bottom-px w-10 sm:hidden"
            style={{ background: 'linear-gradient(to left, var(--color-ink), transparent)' }}
          />
        </div>

        <p className="mb-3 text-xs text-muted">{copy.description}</p>

        {tab === 'active' ? (
          activeFeed.length === 0 ? (
            <div className="rounded border border-dashed border-line px-6 py-12 text-center">
              <p className="font-mono text-base font-bold">{copy.empty}</p>
              <Link
                href="/claim"
                className="mt-5 inline-block rounded bg-gold px-4 py-2 font-mono text-sm font-bold text-ink transition hover:opacity-85"
              >
                CLAIM THE FIRST WORD
              </Link>
            </div>
          ) : (
            <ActivityFeed entries={activeFeed} />
          )
        ) : rows.length === 0 ? (
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
            {/* CGPT-F10: Trending/Rising/Hidden Gems said "check back later" and stopped there —
                a dead end with nothing else to do on the page. These three are the only views
                that can honestly come up empty (not enough real activity yet), so each now
                points somewhere with real content right now instead of asking for a return visit. */}
            {(tab === 'trending' || tab === 'rising' || tab === 'gems') && (
              <Link
                href="/"
                className="mt-5 inline-flex min-h-8 items-center text-sm text-muted underline underline-offset-2 hover:text-text"
              >
                See who&rsquo;s on top right now →
              </Link>
            )}
          </div>
        ) : (
          <ImpressionTracker>
            <ul className="border-t border-line">
              {rows.map((row) => (
                <LeaderboardRow key={row.wordId} row={row} />
              ))}
            </ul>
          </ImpressionTracker>
        )}

        {/* F15: the Top view previously stopped at 50 rows with no indication more existed and
            no way to see them. Only shown for 'top' — it's the one view with a real, unbounded
            ranking every owned word competes on. */}
        {tab === 'top' && rows.length > 0 && totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            {page > 1 ? (
              <Link
                href={`/?tab=top&page=${page - 1}`}
                className="rounded border border-line px-2.5 py-1.5 font-mono hover:border-muted"
              >
                ← PREV
              </Link>
            ) : (
              <span />
            )}
            <span className="tnum text-muted">
              Page {page} of {totalPages} · {totalOwnedWords} owned words
            </span>
            {page < totalPages ? (
              <Link
                href={`/?tab=top&page=${page + 1}`}
                className="rounded border border-line px-2.5 py-1.5 font-mono hover:border-muted"
              >
                NEXT →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </section>

      {/* Suppressed on the 'active' tab — its own content above already IS this same feed, just
          longer; showing it twice back to back would be redundant, not additive. */}
      {tab !== 'active' && <ActivityFeed entries={activity} />}

      {contested.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">
            🔥 MOST FOUGHT OVER
          </h2>
          <ul className="space-y-1 text-sm">
            {contested.map(({ word, takeovers }) => (
              <li key={word.id} className="flex min-h-8 items-center justify-between gap-2">
                {/* inline-flex, not a bare inline link: an inline box is only as tall as its
                    font, so at text-sm these were 20px targets in a tightly stacked list. */}
                <Link
                  href={`/word/${word.normalized}`}
                  className="inline-flex min-h-6 min-w-0 items-center font-mono font-bold uppercase hover:text-gold"
                >
                  <span className="truncate">{word.display}</span>
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
