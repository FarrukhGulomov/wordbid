'use client';

import { useEffect, useRef } from 'react';

/**
 * Wraps a list of rows, each tagged `data-word="<normalized>"`, and reports an impression only
 * once a row has actually scrolled into the viewport — never merely because it was present
 * somewhere in the page's initial HTML.
 *
 * See F10: the previous mechanism (a single beacon fired on mount for every word passed to it)
 * counted every row on the page as "shown" the instant the page loaded, whether or not a visitor
 * ever scrolled far enough to see it — row #40 of a 50-row leaderboard got the exact same
 * impression as row #1. This observes the real DOM, so only rows that genuinely entered the
 * viewport ever get reported, still batched into one request per page load, same as before.
 */
export function ImpressionTracker({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const targets = container.querySelectorAll<HTMLElement>('[data-word]');
    if (targets.length === 0) return;

    let pending = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      flushTimer = null;
      if (pending.size === 0) return;
      const words = [...pending];
      pending = new Set();
      fetch('/api/impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
        keepalive: true,
      }).catch(() => {
        // A missed impression just means one word's count is very slightly low — never worth
        // surfacing to the user.
      });
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const word = entry.target.getAttribute('data-word');
          if (word) pending.add(word);
          observer.unobserve(entry.target);
        }
        if (pending.size > 0 && !flushTimer) {
          // Debounced, not immediate: a fast scroll past several rows batches them into one
          // request instead of firing one per row as each individually crosses the threshold.
          flushTimer = setTimeout(flush, 400);
        }
      },
      { threshold: 0.5 },
    );
    targets.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      if (flushTimer) clearTimeout(flushTimer);
      flush(); // Best-effort: report whatever was actually seen before this view goes away.
    };
  }, [children]);

  return <div ref={containerRef}>{children}</div>;
}
