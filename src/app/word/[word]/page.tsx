import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { ImpressionBeacon } from '@/components/ImpressionBeacon';
import { notFound } from 'next/navigation';
import { getWordByNormalized, getWordCompetitiveSpend } from '@/lib/queries';
import { getOwnershipPerformance } from '@/lib/ownership-stats';
import { normalizeWord } from '@/lib/word';
import { formatUsd, formatCount } from '@/lib/money';
import { minimumBidCents } from '@/lib/pricing';
import { config, SITE_NAME } from '@/lib/config';
import { shortAgo } from '@/lib/time';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ word: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { word: raw } = await params;
  const normalized = normalizeWord(decodeURIComponent(raw));
  const word = await getWordByNormalized(normalized);

  const display = (word?.display ?? normalized).toUpperCase();
  const owner = word?.currentOwnership?.owner;

  const title = owner ? `${display} is owned by ${owner.name}` : `Nobody owns ${display} yet`;
  const description = owner
    ? `${owner.name} owns "${display}" at ${formatUsd(word!.valueCents)} and ranks #${word!.rank} on ${SITE_NAME}. Take it from ${formatUsd(word!.minimumBidCents)}.`
    : `"${display}" is unclaimed. Claim it from ${formatUsd(config.startingPriceCents)} and take a position on the internet.`;

  return {
    title,
    description,
    alternates: { canonical: `/word/${normalized}` },
    openGraph: { title, description, url: `/word/${normalized}`, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
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

  return (
    <div className="py-10">
      <ImpressionBeacon words={[word.normalized]} />

      <p className="font-mono text-xs tracking-widest text-muted">
        {word.rank ? `GLOBAL RANK #${word.rank}` : 'UNRANKED'}
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
              VIEW ANALYTICS →
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
        <p className="mt-2 text-center text-xs text-muted">Paid placement. Not an endorsement.</p>
      </div>

      <section className="mt-10">
        <h2 className="mb-1 font-mono text-xs font-bold tracking-widest text-muted">
          HISTORY OF {display}
        </h2>
        {/* Compact, real competitive proof — never shown for a word that has only ever had one
            owner, and the spend clause only when there has actually been any (never fabricated;
            see getWordCompetitiveSpend, which reads confirmed payments only). */}
        {competitive.takeoverCount > 0 && (
          <p className="mb-3 text-xs text-muted">
            {display} has changed owners {competitive.takeoverCount} time
            {competitive.takeoverCount === 1 ? '' : 's'}.
            {competitive.competitiveSpendCents > 0 && (
              <> {formatUsd(competitive.competitiveSpendCents)} spent competing for it.</>
            )}
          </p>
        )}
        <ul className="divide-y divide-line rounded border border-line">
          {history.map((period) => (
            <li
              key={period.id}
              className="flex flex-col gap-1 px-3 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-3"
            >
              <div className="flex items-baseline gap-2 sm:min-w-0 sm:flex-1">
                <span className="min-w-0 truncate font-medium">{period.owner.name}</span>
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

      <p className="mt-10 text-sm">
        <Link href="/" className="text-muted underline underline-offset-2 hover:text-text">
          ← See who owns the internet
        </Link>
      </p>
    </div>
  );
}
