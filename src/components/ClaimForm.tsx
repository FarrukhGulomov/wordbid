'use client';

import { useEffect, useState } from 'react';
import { normalizeWord } from '@/lib/word';
import { formatUsd, parseUsdToCents } from '@/lib/money';
import { CryptoPaymentNotice } from '@/components/CryptoPaymentNotice';

type Availability = {
  normalized: string;
  display: string;
  owned: boolean;
  valueCents: number;
  minimumBidCents: number;
  owner?: { name: string };
  rank?: number | null;
  /** Where the currently-entered amount would rank TODAY — see getProjectedRank. */
  projectedRank?: number | null;
};

/**
 * The whole claim flow on one screen: WORD -> BRAND/URL -> AMOUNT -> PAY.
 *
 * The price shown here is indicative. The bid is re-checked against the live value when the
 * payment confirms, so a word can still be lost to a competing takeover mid-checkout.
 */
export function ClaimForm({ initialWord, isCrypto = false }: { initialWord: string; isCrypto?: boolean }) {
  const [word, setWord] = useState(initialWord);
  const [brandName, setBrandName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);

  const [availability, setAvailability] = useState<Availability | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const normalized = normalizeWord(word);
  const amountCents = parseUsdToCents(amount);

  // Look up the live price — and, once a real amount is entered, the position it would rank at
  // today — whenever the word or the amount settles.
  useEffect(() => {
    if (!normalized) {
      setAvailability(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const query = amountCents && amountCents > 0 ? `?amount=${amountCents}` : '';
        const res = await fetch(`/api/words/${encodeURIComponent(normalized)}${query}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setAvailability(res.ok ? data : null);
        if (!res.ok) setError(data.error ?? null);
        else setError(null);
      } catch {
        // An aborted or failed lookup is not worth surfacing; the server revalidates anyway.
      } finally {
        setChecking(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, amountCents]);

  // Prefill the minimum price until the buyer types their own number.
  useEffect(() => {
    if (availability && !amountTouched) {
      setAmount((availability.minimumBidCents / 100).toFixed(2).replace(/\.00$/, ''));
    }
  }, [availability, amountTouched]);

  const minimum = availability?.minimumBidCents ?? null;
  const amountTooLow = minimum !== null && amountCents !== null && amountCents < minimum;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (amountCents === null) {
      setError('Enter a valid amount.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word,
          brandName,
          url,
          amountCents,
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Nothing was charged.');
        // The price moved while the form was open — show the new minimum.
        if (typeof data.minimumBidCents === 'number') {
          setAvailability((prev) => (prev ? { ...prev, minimumBidCents: data.minimumBidCents } : prev));
        }
        setSubmitting(false);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      setError('Could not reach the server. Nothing was charged.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label htmlFor="word" className="mb-1 block font-mono text-xs font-bold tracking-widest text-muted">
          1. WORD
        </label>
        <input
          id="word"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="coding"
          maxLength={30}
          required
          autoComplete="off"
          className="w-full rounded border border-line bg-surface px-3 py-2.5 font-mono text-lg uppercase placeholder:normal-case placeholder:text-muted focus:border-gold focus:outline-none"
        />
        <div className="mt-1.5 min-h-5 text-xs">
          {checking && <span className="text-muted">Checking…</span>}
          {!checking && availability?.owned && (
            <span className="text-muted">
              👑 Owned by <span className="text-text">{availability.owner?.name}</span> at{' '}
              {formatUsd(availability.valueCents)}. Take it from{' '}
              <span className="font-bold text-gold">{formatUsd(availability.minimumBidCents)}</span>.
            </span>
          )}
          {!checking && availability && !availability.owned && (
            <span className="text-muted">
              Nobody owns {availability.display.toUpperCase()} yet. Claim it from{' '}
              <span className="font-bold text-gold">{formatUsd(availability.minimumBidCents)}</span>.
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="brand"
            className="mb-1 block font-mono text-xs font-bold tracking-widest text-muted"
          >
            2. YOUR BRAND
          </label>
          <input
            id="brand"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="DevX"
            maxLength={60}
            required
            className="w-full rounded border border-line bg-surface px-3 py-2.5 focus:border-gold focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="url"
            className="mb-1 block font-mono text-xs font-bold tracking-widest text-muted"
          >
            YOUR LINK
          </label>
          <input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="devx.com"
            inputMode="url"
            required
            className="w-full rounded border border-line bg-surface px-3 py-2.5 focus:border-gold focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="description"
          className="mb-1 block font-mono text-xs font-bold tracking-widest text-muted"
        >
          DESCRIPTION (OPTIONAL)
        </label>
        <input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Left blank, we try to pull one from your site automatically"
          maxLength={160}
          className="w-full rounded border border-line bg-surface px-3 py-2.5 text-sm placeholder:text-muted focus:border-gold focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-muted">
          Some sites block automatic detection — type your own if it doesn&apos;t show up after paying.
        </p>
      </div>

      <div>
        <label
          htmlFor="amount"
          className="mb-1 block font-mono text-xs font-bold tracking-widest text-muted"
        >
          3. YOUR PRICE
        </label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xl text-muted">$</span>
          <input
            id="amount"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountTouched(true);
            }}
            placeholder="500"
            inputMode="decimal"
            required
            className="tnum w-full rounded border border-line bg-surface px-3 py-2.5 font-mono text-xl focus:border-gold focus:outline-none"
          />
        </div>
        {amountTooLow && minimum !== null && (
          <p className="mt-1.5 text-xs text-gold">Minimum is {formatUsd(minimum)}.</p>
        )}
        {/* The live position this exact amount would hold today — never shown for an amount
            that wouldn't even win the word, so this can't be read as "pay less, still rank
            here". A snapshot of the current board, not a promise about the one at payment time. */}
        {!amountTooLow && availability?.projectedRank != null && (
          <p className="mt-1.5 text-xs text-muted">
            That would currently rank around{' '}
            <span className="font-bold text-gold">#{availability.projectedRank}</span> on the
            leaderboard — real positions move as other brands pay too.
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted">
          Pay more to rank higher. The whole leaderboard is ordered by this number.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
          {error}
        </p>
      )}

      <div className="rounded border border-line bg-surface-2 p-3 text-xs text-muted">
        <p className="mb-1 font-bold text-text">What you get</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Current ownership of <span className="text-text">{normalized.toUpperCase() || 'this word'}</span> on
            WordBid, and your own public page for it at{' '}
            <span className="text-text">/word/{normalized || '…'}</span>.
          </li>
          <li>
            A real position on the leaderboard — higher rank means more potential visibility, but
            it is competitive placement, never guaranteed traffic.
          </li>
          <li>Every real click and impression your word earns, tracked and visible on its own
            performance page.</li>
        </ul>
      </div>

      <div className="rounded border border-line bg-surface-2 p-3 text-xs text-muted">
        <p className="mb-1 font-bold text-text">Before you pay</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>You are buying temporary placement on this site — not legal ownership of a word.</li>
          <li>Any brand can take this word from you at any time by paying more.</li>
          <li>Previous owners are not paid when a word changes hands.</li>
          <li>No impressions, clicks, traffic or results are guaranteed.</li>
          <li>
            If someone outbids you while your payment is processing, you do not get the word and
            your payment is refunded.
          </li>
        </ul>
      </div>

      {isCrypto && <CryptoPaymentNotice />}

      <button
        type="submit"
        disabled={submitting || amountTooLow || !normalized}
        className="w-full rounded bg-gold px-4 py-3 font-mono text-sm font-bold text-ink transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting
          ? 'STARTING CHECKOUT…'
          : `PAY ${amountCents !== null ? formatUsd(amountCents) : ''} & OWN ${normalized.toUpperCase() || 'IT'}`}
      </button>
    </form>
  );
}
