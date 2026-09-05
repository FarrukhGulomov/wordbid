'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { normalizeWord } from '@/lib/word';

/** Hero input: type any word, go straight to claiming it. No results page in between. */
export function WordSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeWord(value);
    if (!normalized) return;
    router.push(`/claim?word=${encodeURIComponent(normalized)}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type any word…"
        aria-label="Word to claim"
        maxLength={30}
        autoComplete="off"
        className="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-2.5 font-mono text-base uppercase placeholder:normal-case placeholder:text-muted focus:border-gold focus:outline-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded bg-gold px-4 py-2.5 font-mono text-sm font-bold text-ink transition hover:opacity-85"
      >
        CLAIM
      </button>
    </form>
  );
}
