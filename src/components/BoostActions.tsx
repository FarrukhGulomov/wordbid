'use client';

import { useState } from 'react';
import { formatUsd } from '@/lib/money';

type Target = { rank: number; targetValueCents: number };

/**
 * BOOST RANK — the current owner pays only the difference to raise their word's value and move
 * up the leaderboard. Deliberately just a few preset buttons, no custom-amount form: BOOST is
 * meant to stay a lightweight action, not a bidding dashboard.
 */
export function BoostActions({ word, targets }: { word: string; targets: Target[] }) {
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
    <section className="mt-8">
      <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">BOOST RANK</h2>
      <p className="mb-3 text-xs text-muted">
        Pay the difference to increase your word&apos;s value and global rank. You keep the
        word — this is not a takeover.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {targets.map((t) => (
          <button
            key={t.rank}
            type="button"
            disabled={pending !== null}
            onClick={() => boost(t.targetValueCents)}
            className="rounded border border-gold px-3 py-2 text-left font-mono text-xs font-bold text-gold transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending === t.targetValueCents
              ? 'STARTING…'
              : t.rank === 1
                ? `BOOST TO #1 — ${formatUsd(t.targetValueCents)}`
                : `BOOST ABOVE #${t.rank} — ${formatUsd(t.targetValueCents)}`}
          </button>
        ))}
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
