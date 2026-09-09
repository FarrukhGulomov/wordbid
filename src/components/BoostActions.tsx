'use client';

import { useState } from 'react';
import { formatUsd } from '@/lib/money';
import { CryptoPaymentNotice } from '@/components/CryptoPaymentNotice';

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
 *
 * CGPT-F02: a boost sits on the SAME page as TAKE FOR $X, and used to be one click away from a real
 * charge with the beneficiary named only in a small paragraph above the button row — a rushed
 * visitor could easily read "BOOST ABOVE #7 — PAY $33.46" as their own cheaper way to get the
 * word, not as money spent on someone else's placement. Two changes fix that: the beneficiary's
 * name is now IN the button itself, and clicking a target opens a one-line confirmation ("Boost
 * {ownerName}'s placement — pay $X. {ownerName} keeps {word}. This does not make you the owner.")
 * that must be confirmed separately before checkout ever starts.
 */
export function BoostActions({
  word,
  currentRank,
  currentValueCents,
  targets,
  ownerName,
  isCrypto = false,
}: {
  word: string;
  currentRank: number;
  currentValueCents: number;
  targets: Target[];
  ownerName: string;
  isCrypto?: boolean;
}) {
  const [selected, setSelected] = useState<Target | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (targets.length === 0) return null;

  async function confirmBoost() {
    if (!selected) return;
    setError(null);
    setStarting(true);
    try {
      const res = await fetch('/api/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, targetValueCents: selected.targetValueCents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not start the boost. Nothing was charged.');
        setStarting(false);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      setError('Could not reach the server. Nothing was charged.');
      setStarting(false);
    }
  }

  const selectedPayCents = selected ? selected.targetValueCents - currentValueCents : 0;

  return (
    <section id="boost" className="mt-6 scroll-mt-4">
      <h2 className="mb-1 font-mono text-xs font-bold tracking-widest text-muted">
        BOOST {word.toUpperCase()}
      </h2>
      <p className="mb-3 text-xs text-muted">
        Pay the difference to raise {ownerName}&rsquo;s placement for this word. {ownerName} keeps
        the word — this is not a takeover, and it never makes you the owner.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {targets.map((t) => {
          const payCents = t.targetValueCents - currentValueCents;
          const isSelected = selected?.rank === t.rank;
          return (
            <button
              key={t.rank}
              type="button"
              disabled={starting}
              aria-pressed={isSelected}
              onClick={() => {
                setError(null);
                setSelected(isSelected ? null : t);
              }}
              className={`rounded border px-3 py-2 text-left font-mono transition disabled:cursor-not-allowed disabled:opacity-40 ${
                isSelected
                  ? 'border-gold bg-gold text-ink'
                  : 'border-gold text-gold hover:bg-gold hover:text-ink'
              }`}
            >
              <span className="block text-xs font-bold">
                {t.rank === 1
                  ? `BOOST ${ownerName.toUpperCase()} TO #1 — PAY ${formatUsd(payCents)}`
                  : `BOOST ${ownerName.toUpperCase()} ABOVE #${t.rank} — PAY ${formatUsd(payCents)}`}
              </span>
              {/* CGPT-F11: this is the exact number backing the decision above it — what rank/value
                  the boost actually buys — and it sat at 10px with opacity-70 stacked on top,
                  well under the 12px floor and with reduced contrast on already-muted text. */}
              <span className="mt-0.5 block text-xs font-normal">
                #{currentRank} {formatUsd(currentValueCents)} → new value {formatUsd(t.targetValueCents)}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mt-3 rounded border border-gold/40 bg-gold/10 p-3 text-sm">
          <p>
            Confirm: pay <span className="font-bold text-gold">{formatUsd(selectedPayCents)}</span> to
            boost <span className="font-bold text-text">{ownerName}</span>&rsquo;s placement for{' '}
            {word.toUpperCase()}.{' '}
            <span className="text-muted">
              {ownerName} keeps the word. This does not make you the owner.
            </span>
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={starting}
              onClick={confirmBoost}
              className="rounded bg-gold px-4 py-2 font-mono text-xs font-bold text-ink transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting ? 'STARTING…' : `CONFIRM — PAY ${formatUsd(selectedPayCents)}`}
            </button>
            <button
              type="button"
              disabled={starting}
              onClick={() => setSelected(null)}
              className="rounded border border-line px-4 py-2 font-mono text-xs font-bold text-muted transition hover:border-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold"
        >
          {error}
        </p>
      )}
      {isCrypto && (
        <div className="mt-3">
          <CryptoPaymentNotice />
        </div>
      )}
    </section>
  );
}
