import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { formatUsd, formatCount } from '@/lib/money';
import type { LeaderboardRow as Row } from '@/lib/queries';

/**
 * One row of the global leaderboard: rank, word, owner, value, clicks, two actions.
 *
 * #1 gets a subtle premium treatment — a crown, a touch more weight, a faint gold wash — never
 * a card, gradient or animation. It's the one row that should read as a trophy at a glance.
 *
 * Stacks into three lines below `sm` (word/owner, value+clicks, actions) instead of squeezing
 * every block into one row — on a ~360px phone the original single-row layout left almost no
 * room for the word/owner text once rank, value, clicks and two buttons all claimed space.
 */
export function LeaderboardRow({ row }: { row: Row }) {
  const isTop = row.rank === 1;

  return (
    <li
      className={`flex flex-col gap-3 border-b px-1 py-4 sm:flex-row sm:items-center sm:gap-4 ${
        isTop ? 'border-gold/30 bg-gold/5' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-3 sm:min-w-0 sm:flex-1">
        <span
          className={`tnum w-8 shrink-0 font-mono sm:w-10 ${
            isTop ? 'text-sm text-gold sm:text-base' : 'text-sm text-muted sm:text-base'
          }`}
        >
          {isTop ? '👑 #1' : `#${row.rank}`}
        </span>

        <div className="min-w-0 flex-1">
          <Link
            href={`/word/${row.normalized}`}
            className={`block truncate font-mono font-bold uppercase tracking-tight hover:text-gold ${
              isTop ? 'text-lg sm:text-xl' : 'text-base sm:text-lg'
            }`}
          >
            {row.display}
          </Link>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-sm text-muted">
            <BrandLogo src={row.ownerLogoUrl} size={16} />
            <span className="truncate">{row.ownerName}</span>
          </div>
        </div>
      </div>

      {/* Value + clicks: one combined line on mobile, a right-aligned stack on desktop. */}
      <div className="flex items-baseline gap-2 pl-11 sm:hidden">
        <span className="tnum font-mono text-base font-bold text-gold">
          {formatUsd(row.valueCents)}
        </span>
        <span className="tnum text-xs text-muted">
          · {formatCount(row.clickCount)} clicks delivered
        </span>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <div className="tnum font-mono text-base font-bold text-gold sm:text-lg">
          {formatUsd(row.valueCents)}
        </div>
        <div className="tnum text-xs text-muted">{formatCount(row.clickCount)} clicks delivered</div>
      </div>

      <div className="flex shrink-0 gap-2 pl-11 sm:pl-0">
        <a
          href={`/go/${row.normalized}`}
          rel="nofollow sponsored noopener"
          className="flex-1 rounded border border-line px-2 py-1.5 text-center font-mono text-[11px] font-bold text-muted transition hover:border-muted hover:text-text sm:flex-none sm:py-1"
        >
          VISIT
        </a>
        <Link
          href={`/claim?word=${encodeURIComponent(row.normalized)}`}
          className="flex-1 rounded border border-gold px-2 py-1.5 text-center font-mono text-[11px] font-bold text-gold transition hover:bg-gold hover:text-ink sm:flex-none sm:py-1"
        >
          TAKE FOR {formatUsd(row.minimumBidCents)}
        </Link>
      </div>
    </li>
  );
}
