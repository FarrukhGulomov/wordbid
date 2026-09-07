import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { formatUsd, formatCount } from '@/lib/money';
import type { LeaderboardRow as Row } from '@/lib/queries';

/**
 * One row of the global leaderboard: rank/word, owner, value, clicks, two actions.
 *
 * The BRAND — logo, name, value, clicks — is the dominant visual element, not the word: a
 * visitor scanning the board should recognize the brand at a glance, with the word read as
 * "the slot this brand bought", not the headline. The brand block is one tappable link straight
 * to the owner's real site (`/go/<word>`, the existing tracked, deduped, bot-filtered outbound
 * redirect — unchanged), with the click count that link earned shown directly inside it, so
 * "what happens if I tap this" and "what has tapping it already done" sit in the same place.
 *
 * The word keeps its own, smaller link to `/word/<word>` (rank history, boost, analytics) as a
 * sibling element, never nested inside the brand's own anchor. #1 gets a subtle premium
 * treatment — a crown, a touch more weight, a faint gold wash — never a card, gradient or
 * animation.
 */
export function LeaderboardRow({ row }: { row: Row }) {
  const isTop = row.rank === 1;

  return (
    <li className={`border-b px-1 py-4 ${isTop ? 'border-gold/30 bg-gold/5' : 'border-line'}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-2 sm:w-36 sm:shrink-0">
          <span className={`tnum shrink-0 font-mono text-xs ${isTop ? 'text-gold' : 'text-muted'}`}>
            {isTop ? '👑 #1' : `#${row.rank}`}
          </span>
          <Link
            href={`/word/${row.normalized}`}
            className={`truncate font-mono text-xs font-bold uppercase tracking-widest hover:text-gold ${
              isTop ? 'text-gold' : 'text-muted'
            }`}
          >
            {row.display}
          </Link>
        </div>

        <a
          href={`/go/${row.normalized}`}
          rel="nofollow sponsored noopener"
          className="flex min-w-0 flex-1 items-center gap-3 rounded border border-line bg-surface px-3 py-2.5 transition hover:border-gold/50 hover:bg-surface-2"
        >
          <BrandLogo src={row.ownerLogoUrl} size={40} className="rounded" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold text-text sm:text-lg">{row.ownerName}</div>
            <div className="tnum mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <span className="font-mono font-bold text-gold">{formatUsd(row.valueCents)}</span>
              <span>· {formatCount(row.clickCount)} clicks delivered</span>
            </div>
          </div>
          <span className="hidden shrink-0 font-mono text-[10px] font-bold text-muted sm:block">
            VISIT →
          </span>
        </a>

        <Link
          href={`/claim?word=${encodeURIComponent(row.normalized)}`}
          className="w-full shrink-0 rounded border border-gold px-3 py-2 text-center font-mono text-[11px] font-bold text-gold transition hover:bg-gold hover:text-ink sm:w-auto sm:py-1.5"
        >
          TAKE FOR {formatUsd(row.minimumBidCents)}
        </Link>
      </div>

      {row.highlight && <p className="mt-1.5 pl-1 text-xs text-gold sm:pl-[9.75rem]">{row.highlight}</p>}
    </li>
  );
}
