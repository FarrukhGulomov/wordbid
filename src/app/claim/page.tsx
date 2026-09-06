import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClaimForm } from '@/components/ClaimForm';
import { normalizeWord } from '@/lib/word';
import { getMetrics } from '@/lib/metrics';
import { getTotalVisitors } from '@/lib/attention';
import { formatCount, formatUsd } from '@/lib/money';

export const metadata: Metadata = {
  title: 'Claim a word',
  description: 'Claim a word, link your brand, and take a position on the global leaderboard.',
};

export const dynamic = 'force-dynamic';

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ word?: string }>;
}) {
  const { word } = await searchParams;
  const initialWord = word ? normalizeWord(word) : '';
  const [metrics, visitors] = await Promise.all([getMetrics(), getTotalVisitors()]);

  return (
    <div className="py-10">
      <h1 className="font-mono text-2xl font-black tracking-tight sm:text-3xl">CLAIM A WORD</h1>
      <p className="mt-2 font-mono text-xs font-bold tracking-widest text-gold">
        ONE WORD. ONE OWNER.
      </p>
      <p className="mt-1 mb-6 text-sm text-muted">
        Own it, climb the rank, earn real attention — until a competitor takes it from you.
      </p>
      {/* Real numbers only, never a fabricated count — skipped entirely while the platform has
          nothing real to show yet (see the discovery engine's own "never fabricate" rule). */}
      {metrics.claimedWords > 0 && (
        <p className="mb-8 text-xs text-muted">
          {formatCount(metrics.claimedWords)} word{metrics.claimedWords === 1 ? '' : 's'} owned ·{' '}
          {formatCount(metrics.takeovers)} takeover{metrics.takeovers === 1 ? '' : 's'} ·{' '}
          {formatCount(metrics.outboundClicks)} clicks delivered
          {visitors > 0 && <> · {formatCount(visitors)} visitors</>}
          {metrics.competitiveSpendCents > 0 && (
            <> · {formatUsd(metrics.competitiveSpendCents)} spent competing for rank</>
          )}
        </p>
      )}
      <Suspense>
        <ClaimForm initialWord={initialWord} />
      </Suspense>
    </div>
  );
}
