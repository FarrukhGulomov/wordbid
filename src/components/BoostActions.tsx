'use client';

import { useState } from 'react';
import { formatUsd } from '@/lib/money';

type Target = { rank: number; targetValueCents: number };

/**
 * Raises the word's own value (and rank) by the DIFFERENCE charged — the money always applies to
 * the word's CURRENT owner, looked up server-side in /api/boost, never taken from the request.
 * Lives on the word page itself (not buried in analytics) because "want more visibility" is a
 * commercial decision, not a performance-review one — see the word page for where this is mounted.
 *
 * WordBid has no login, so it can never confirm the visitor clicking this IS the current owner —
 * the copy stays neutral and transactional ("boost this word") rather than addressing the reader
 * as "you"/"your word", which would wrongly imply a verified owner identity.
 *
 * The button leads with what gets paid (PAY $X), never the resulting total value — a $40
 * difference converts better and reads more honestly than a $50 headline number that hides how
 * much of it the word already had "banked" in its current value.
 */
export function BoostActions({
  word,
  currentRank,
  currentValueCents,
  targets,
}: {
  word: string;
  currentRank: number;
  currentValueCents: number;
  targets: Target[];
}) {
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (targets.length === 0) return null;

  async function boost(targetValueCents: number) {
    setError(null);
    setPending(targetValueCents);
    try {
      const res = await fetch('/api/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, targetValueCents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not start the boost. Nothing was charged.');
        setPending(null);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      setError('Could not reach the server. Nothing was charged.');
      setPending(null);
    }
  }

  return (
    <section id="boost" className="mt-6 scroll-mt-4">
      <h2 className="mb-1 font-mono text-xs font-bold tracking-widest text-muted">
        BOOST {word.toUpperCase()}
      </h2>
      <p className="mb-3 text-xs text-muted">
        Pay the difference to raise this word&rsquo;s value and rank. The current owner keeps the
        word — this is not a takeover.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {targets.map((t) => {
          const payCents = t.targetValueCents - currentValueCents;
          return (
            <button
              key={t.rank}
              type="button"
              disabled={pending !== null}
              onClick={() => boost(t.targetValueCents)}
              className="rounded border border-gold px-3 py-2 text-left font-mono text-gold transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="block text-xs font-bold">
                {pending === t.targetValueCents
                  ? 'STARTING…'
                  : t.rank === 1
                    ? `BOOST TO #1 — PAY ${formatUsd(payCents)}`
                    : `BOOST ABOVE #${t.rank} — PAY ${formatUsd(payCents)}`}
              </span>
              <span className="mt-0.5 block text-[10px] font-normal opacity-70">
                #{currentRank} {formatUsd(currentValueCents)} → new value {formatUsd(t.targetValueCents)}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold"
        >
          {error}
        </p>
      )}
    </section>
  );
}
