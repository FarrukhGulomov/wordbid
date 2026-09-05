'use client';

import { useEffect } from 'react';

/**
 * Renders nothing. Fires once on mount: "these words' listings were just shown to a real
 * browser." A crawler that never runs JavaScript never triggers this at all — the same
 * principle as VisitorHeartbeat.
 */
export function ImpressionBeacon({ words }: { words: string[] }) {
  // Comparing the joined string keeps the effect from re-firing on every render when the
  // caller passes a fresh array literal with the same contents.
  const key = words.join(',');

  useEffect(() => {
    if (!key) return;
    fetch('/api/impression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: key.split(',') }),
      keepalive: true,
    }).catch(() => {
      // A missed impression just means one word's count is very slightly low — never worth
      // surfacing to the user.
    });
  }, [key]);

  return null;
}
