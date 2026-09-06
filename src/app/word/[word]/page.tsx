import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { ImpressionBeacon } from '@/components/ImpressionBeacon';
import { notFound } from 'next/navigation';
import { getWordByNormalized, getWordCompetitiveSpend, getBoostCandidates, getLeaderboard } from '@/lib/queries';
import { getOwnershipPerformance } from '@/lib/ownership-stats';
import { normalizeWord } from '@/lib/word';
import { formatUsd, formatCount } from '@/lib/money';
import { minimumBidCents, boostTargetFor } from '@/lib/pricing';
import { config, SITE_NAME } from '@/lib/config';
import { shortAgo } from '@/lib/time';
import { BoostActions } from '@/components/BoostActions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ word: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { word: raw } = await params;
  const normalized = normalizeWord(decodeURIComponent(raw));
  const word = await getWordByNormalized(normalized);

  const display = (word?.display ?? normalized).toUpperCase();
  const owner = word?.currentOwnership?.owner;

  // An owned word is a real, unique landing page — title/description use only its own current
  // ownership/value/rank. An unowned (or nonexistent/blocked — getWordByNormalized already
  // returns null for both) word carries no real content of its own yet, so it's marked noindex:
  // the dynamic /word/[word] route would otherwise let a crawler index one thin page per
  // possible string ever linked to it, with nothing real to show.
  const title = owner
    ? `Who Owns ${display}? Current Owner, Value & Rank`
    : `Claim ${display} — Unowned Word`;
  const description = owner
    ? `${owner.name} currently owns "${display}" on ${SITE_NAME} at ${formatUsd(word!.valueCents)}, ranked #${word!.rank}. Take it over for ${formatUsd(word!.minimumBidCents)}.`
    : `"${display}" is unclaimed on ${SITE_NAME}. Claim it from ${formatUsd(config.startingPriceCents)} and take a position on the internet.`;

  return {
    title,
    description,
    alternates: { canonical: `/word/${normalized}` },
    openGraph: { title, description, url: `/word/${normalized}`, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
    ...(owner ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function WordPage({ params }: Props) {
  const { word: raw } = await params;
  const normalized = normalizeWord(decodeURIComponent(raw));
  if (!normalized) notFound();

  const word = await getWordByNormalized(normalized);
  const display = (word?.display ?? normalized).toUpperCase();
  const owner = word?.currentOwnership?.owner ?? null;
  const takePrice = word ? word.minimumBidCents : minimumBidCents(0);

  // Unowned: the whole page is one offer.
  if (!word || !owner) {
    return (
      <div className="py-16 text-center">
        <p className="font-mono text-xs tracking-widest text-muted">UNCLAIMED</p>
        <h1 className="mt-2 font-mono text-4xl font-black uppercase tracking-tighter sm:text-5xl">
          {display}
        </h1>
        <p className="mt-4 text-muted">
          Nobody owns {display} yet. Claim it from{' '}
          <span className="font-bold text-gold">{formatUsd(takePrice)}</span>.
        </p>
        <Link
          href={`/claim?word=${encodeURIComponent(normalized)}`}
          className="mt-6 inline-block rounded bg-gold px-5 py-2.5 font-mono text-sm font-bold text-ink transition hover:opacity-85"
        >
          CLAIM {display}
        </Link>
        <p className="mt-2 text-xs text-muted">One word. One owner.</p>
        <p className="mt-8 text-sm">
          <Link href="/" className="text-muted underline underline-offset-2 hover:text-text">
            ← See who owns the internet
          </Link>
        </p>
      </div>
    );
  }

  const history = word.ownerships;
  const performance = word.currentOwnership ? await getOwnershipPerformance(word.currentOwnership.id) : null;
  const competitive = await getWordCompetitiveSpend(word.id);
  const boostCandidates = word.rank ? await getBoostCandidates(word.rank) : [];
  const boostTargets = boostCandidates.map(boostTargetFor);
  // Real internal links to nearby leaderboard rows — one bounded query, up to 4 consecutive
  // rows centered on this word's own rank, filtered to exclude the word itself.
  const nearby = word.rank
    ? (await getLeaderboard(4, Math.max(0, word.rank - 2))).filter((row) => row.wordId !== word.id)
    : [];

  // Valid, minimal structured data reflecting exactly the visible nav below (Home → word) —
  // nothing invented about the word or its owner beyond that real navigational relationship.
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: config.siteUrl },
      { '@type': 'ListItem', position: 2, name: display, item: `${config.siteUrl}/word/${word.normalized}` },
    ],
  };

  return (
    <div className="py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <ImpressionBeacon words={[word.normalized]} />

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs tracking-widest text-muted">
        <span>{word.rank ? `GLOBAL RANK #${word.rank}` : 'UNRANKED'}</span>
        {/* Only ever shown when there's a real prior observation to compare against — see
            getRankDeltaSince. No "steady" badge for a zero change; nothing fabricated. */}
        {word.rankDelta !== null && word.rankDelta !== 0 && (
          <span className={word.rankDelta > 0 ? 'text-gold' : 'text-muted'}>
            {word.rankDelta > 0 ? `▲ UP ${word.rankDelta}` : `▼ DOWN ${Math.abs(word.rankDelta)}`}
          </span>
        )}
        {word.costToReachNumberOneCents !== null && (
          <span>· {formatUsd(word.costToReachNumberOneCents)} to take #1</span>
        )}
      </p>
      <h1 className="mt-1 font-mono text-4xl font-black uppercase tracking-tighter sm:text-5xl">
        {display}
      </h1>

      <div className="mt-6 rounded border border-line bg-surface p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <BrandLogo src={owner.logoUrl} size={32} className="rounded" />
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted">👑 OWNED BY</p>
            <p className="truncate text-lg font-bold">{owner.name}</p>
            {/* WordBid never verifies that a buyer controls the domain they check out with —
                so this names the raw linked domain rather than implying an official, verified
                claim by the brand shown above. */}
            <p className="truncate text-xs text-muted">Linked website: {owner.domain}</p>
          </div>
        </div>

        {owner.description ? (
          <p className="mt-3 text-sm text-muted">{owner.description}</p>
        ) : null}

        {/* Primary purchase decision only: who owns it, what it's worth, what it costs to take.
            Impressions/CTR/traffic history live behind VIEW ANALYTICS — this card must not
            turn into an analytics dashboard. */}
        <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
          <div>
            <dt className="font-mono text-xs text-muted">CURRENT VALUE</dt>
            <dd className="tnum font-mono text-xl font-bold text-gold">
              {formatUsd(word.valueCents)}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-muted">CLICKS DELIVERED</dt>
            {/* Earned by the CURRENT owner only — a takeover always starts back at 0. */}
            <dd className="tnum font-mono text-xl font-bold">
              {formatCount(word.currentOwnership?.clickCount ?? 0)}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-muted">TAKEOVER PRICE</dt>
            <dd className="tnum font-mono text-xl font-bold">{formatUsd(takePrice)}</dd>
          </div>
        </dl>

        {performance ? (
          <p className="mt-3 text-xs">
            <Link
              href={`/word/${word.normalized}/analytics`}
              className="text-muted underline underline-offset-2 hover:text-text"
            >
              VIEW PERFORMANCE →
            </Link>
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <a
            href={`/go/${word.normalized}`}
            rel="nofollow sponsored noopener"
            className="flex-1 rounded border border-line px-4 py-2.5 text-center font-mono text-sm font-bold transition hover:border-muted"
          >
            VISIT {owner.name.toUpperCase()}
          </a>
          <Link
            href={`/claim?word=${encodeURIComponent(word.normalized)}`}
            className="flex-1 rounded bg-gold px-4 py-2.5 text-center font-mono text-sm font-bold text-ink transition hover:opacity-85"
          >
            TAKE FOR {formatUsd(takePrice)}
          </Link>
        </div>
        <p className="mt-2 text-center text-xs text-muted">
          Paid placement. Domain not verified. Not an endorsement.
        </p>
      </div>

      {/* SEO-facing summary of exactly the real facts already shown above, in prose form for
          search snippets and first-time readers — never a fabricated fact about the word
          itself, only its real ownership status on WordBid. */}
      <section className="mt-6 text-sm text-muted">
        <h2 className="mb-1 font-mono text-xs font-bold tracking-widest text-muted">
          ABOUT {display} ON {SITE_NAME.toUpperCase()}
        </h2>
        <p>
          {display} is currently owned by {owner.name}, valued at {formatUsd(word.valueCents)} and
          ranked #{word.rank} on {SITE_NAME}.{' '}
          {competitive.takeoverCount > 0
            ? `It has changed owners ${competitive.takeoverCount} time${competitive.takeoverCount === 1 ? '' : 's'}${
                competitive.competitiveSpendCents > 0
                  ? `, with ${formatUsd(competitive.competitiveSpendCents)} spent competing for it`
                  : ''
              }. `
            : 'It has not changed owners yet. '}
          Taking it over from {owner.name} currently costs {formatUsd(takePrice)}.
        </p>
      </section>

      {word.rank && (
        <BoostActions
          word={word.normalized}
          currentRank={word.rank}
          currentValueCents={word.valueCents}
          targets={boostTargets}
        />
      )}

      <section className="mt-10">
        <h2 className="mb-3 font-mono text-xs font-bold tracking-widest text-muted">
          {/* The "changed owners N times" fact now lives in the ABOUT section above — this
              heading alone is enough context for the list below it. */}
          {competitive.takeoverCount > 0 ? `THE BATTLE FOR ${display}` : `HISTORY OF ${display}`}
        </h2>
        <ul className="divide-y divide-line rounded border border-line">
          {history.map((period) => (
            <li
              key={period.id}
              className="flex flex-col gap-1 px-3 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-3"
            >
              <div className="flex items-baseline gap-2 sm:min-w-0 sm:flex-1">
                <span className="min-w-0 truncate font-medium">
                  {/* A prior owner was, by definition, overtaken — the arrow marks that this
                      period ended because someone else ranked higher, not just "time passed". */}
                  {period.endedAt !== null && <span className="mr-1 text-muted">↑</span>}
                  {period.owner.name}
                </span>
                {period.endedAt === null && <span className="text-xs font-bold text-gold">CURRENT</span>}
              </div>
              <div className="flex items-baseline gap-3 text-xs sm:shrink-0">
                <span className="tnum font-mono text-sm text-gold">
                  {formatUsd(period.amountCents)}
                </span>
                <span className="tnum text-muted">{formatCount(period.clickCount)} clicks</span>
                <span className="tnum w-10 shrink-0 text-right text-muted">
                  {period.endedAt === null ? '' : shortAgo(period.startedAt)}
                </span>
                {period.endedAt !== null && (
                  <Link
                    href={`/claim?word=${encodeURIComponent(word.normalized)}`}
                    className="shrink-0 font-mono font-bold text-gold underline underline-offset-2 hover:text-text"
                  >
                    RECLAIM FOR {formatUsd(takePrice)}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {nearby.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">
            NEARBY ON THE LEADERBOARD
          </h2>
          <ul className="space-y-1 text-sm">
            {nearby.map((row) => (
              <li key={row.wordId} className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/word/${row.normalized}`}
                  className="truncate font-mono font-bold uppercase hover:text-gold"
                >
                  #{row.rank} {row.display}
                </Link>
                <span className="tnum shrink-0 text-xs text-muted">{formatUsd(row.valueCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-sm">
        <Link href="/" className="text-muted underline underline-offset-2 hover:text-text">
          ← See who owns the internet
        </Link>
      </p>
    </div>
  );
}
