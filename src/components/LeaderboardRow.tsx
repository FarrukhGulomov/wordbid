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
    <li
      data-word={row.normalized}
      className={`border-b px-1 py-4 ${isTop ? 'border-gold/30 bg-gold/5' : 'border-line'}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-2 sm:w-36 sm:shrink-0">
          {/* CGPT-F06: on Trending/Rising/Hidden Gems/New, rows are sorted by that view's own signal
              (clicks, climb, CTR, recency) — never by this number. A bare "#9" next to a "👑 #1"
              two rows down read as "list position" and contradicted the visible order. "RANK"
              makes clear it is the word's GLOBAL paid-value rank, unrelated to where it sits in
              this particular list. */}
          <span className={`tnum shrink-0 font-mono text-xs ${isTop ? 'text-gold' : 'text-muted'}`}>
            {isTop ? '👑 RANK #1' : `RANK #${row.rank}`}
          </span>
          {/* min-h-6 / min-w-0: WCAG 2.5.8 wants at least 24px of tappable height, and at
              text-xs this link was only 16px tall — the smallest target on the busiest screen. */}
          <Link
            href={`/word/${row.normalized}`}
            className={`flex min-h-6 min-w-0 items-center font-mono text-xs font-bold uppercase tracking-widest hover:text-gold ${
              isTop ? 'text-gold' : 'text-muted'
            }`}
          >
            <span className="truncate">{row.display}</span>
          </Link>
        </div>

        <a
          href={`/go/${row.normalized}`}
          rel="nofollow sponsored noopener"
          className="flex min-w-0 flex-1 items-center gap-3 rounded border border-line bg-surface px-3 py-2.5 transition hover:border-gold/50 hover:bg-surface-2"
        >
          <BrandLogo src={row.ownerLogoUrl} name={row.ownerName} size={40} className="rounded" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold text-text sm:text-lg">{row.ownerName}</div>
            <div className="tnum mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <span className="font-mono font-bold text-gold">{formatUsd(row.valueCents)}</span>
              <span>· {formatCount(row.clickCount)} clicks delivered</span>
            </div>
            {/* A short, real description of the owner's own site — never a placeholder when
                there isn't one (see getLeaderboard's ownerDescription, sourced straight from
                Owner.description). Clamped to one line: this list row must stay compact, unlike
                the word page's own OwnerDescription, which affords three. */}
            {row.ownerDescription && (
              <p className="mt-0.5 line-clamp-1 text-xs text-muted">{row.ownerDescription}</p>
            )}
          </div>
          <span className="hidden shrink-0 font-mono text-xs font-bold text-muted sm:block">
            VISIT →
          </span>
        </a>

        {/* Fixed width from `sm` up: sized by its price, this button was wider on $1,200 rows
            than on $9 ones, which pushed the brand cards to different widths and left the
            column's right edge sawtoothed all the way down the page. */}
        <Link
          href={`/claim?word=${encodeURIComponent(row.normalized)}`}
          className="w-full shrink-0 rounded border border-gold px-3 py-2 text-center font-mono text-xs font-bold text-gold transition hover:bg-gold hover:text-ink sm:w-40 sm:py-1.5"
        >
          TAKE FOR {formatUsd(row.minimumBidCents)}
        </Link>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 pl-1 sm:pl-[9.75rem]">
        {row.highlight ? <p className="text-xs text-gold">{row.highlight}</p> : <span />}
        {/* The word's own page (rank history, full description, boost, real click/impression
            stats) is the "details" this links to — no separate modal or duplicate content. */}
        <Link
          href={`/word/${row.normalized}`}
          className="inline-flex min-h-6 shrink-0 items-center text-xs text-muted underline underline-offset-2 hover:text-text"
        >
          See details →
        </Link>
      </div>
    </li>
  );
}
