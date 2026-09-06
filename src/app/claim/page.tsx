import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClaimForm } from '@/components/ClaimForm';
import { normalizeWord } from '@/lib/word';

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

  return (
    <div className="py-10">
      <h1 className="font-mono text-2xl font-black tracking-tight sm:text-3xl">CLAIM A WORD</h1>
      <p className="mt-2 text-sm text-muted">Own the word that defines your brand.</p>
      <p className="mt-1 mb-8 text-sm text-muted">
        Word → brand → price → pay. Highest price ranks #1.
      </p>
      <Suspense>
        <ClaimForm initialWord={initialWord} />
      </Suspense>
    </div>
  );
}
