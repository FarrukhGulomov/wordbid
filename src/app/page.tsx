import Link from 'next/link';
import { LeaderboardRow } from '@/components/LeaderboardRow';
import { ActivityFeed } from '@/components/ActivityFeed';
import { WordSearch } from '@/components/WordSearch';
import { getLeaderboard, getRecentActivity, getMostFoughtOver } from '@/lib/queries';
import { formatUsd } from '@/lib/money';
import { config } from '@/lib/config';

// The leaderboard is the product; it must never be served stale.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [board, activity, contested] = await Promise.all([
    getLeaderboard(50),
    getRecentActivity(6),
    getMostFoughtOver(6),
  ]);

  return (
    <>
      <section className="py-8 text-center sm:py-10">
        <h1 className="font-mono text-4xl font-black tracking-tighter sm:text-6xl">
          OWN THE INTERNET
        </h1>
        <p className="mt-2 text-base text-text sm:text-lg">
          Every word has one owner. Until someone takes it.
        </p>
        <p className="mt-1 text-sm text-muted">Claim a word. Own a position. Get seen.</p>

        <div className="mx-auto mt-6 max-w-md">
          <WordSearch />
          <p className="mt-2 text-xs text-muted">
            Unclaimed words start at {formatUsd(config.startingPriceCents)}. Owned words cost{' '}
            {config.takeoverIncrementPercent}% more than the current price.
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-mono text-sm font-bold tracking-widest">
          👑 WHO OWNS THE INTERNET?
        </h2>
        <p className="mb-4 text-xs text-muted">
          Ranked by what the current owner paid. Pay more than the owner and the word is yours.
        </p>

        {board.length === 0 ? (
          <div className="rounded border border-dashed border-line px-6 py-12 text-center">
            <p className="font-mono text-base font-bold">Nobody owns anything yet.</p>
            <p className="mt-2 text-sm text-muted">
              The first word claimed becomes #1 on the internet.
            </p>
            <Link
              href="/claim"
              className="mt-5 inline-block rounded bg-gold px-4 py-2 font-mono text-sm font-bold text-ink transition hover:opacity-85"
            >
              CLAIM THE FIRST WORD
            </Link>
          </div>
        ) : (
          <ul className="border-t border-line">
            {board.map((row) => (
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
