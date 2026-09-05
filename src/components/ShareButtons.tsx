'use client';

import { useState } from 'react';

/**
 * The entire viral loop, kept deliberately tiny: a link to X pre-filled with the claim, and a
 * copy-to-clipboard button for the canonical word URL. No share-card generation, no social graph.
 */
export function ShareButtons({ shareText, canonicalUrl }: { shareText: string; canonicalUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked (permissions, insecure context); fail quietly.
    }
  }

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(canonicalUrl)}`;

  return (
    <div className="flex gap-2">
      <a
        href={tweetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 rounded border border-line px-4 py-2.5 text-center font-mono text-sm font-bold transition hover:border-muted"
      >
        SHARE ON X
      </a>
      <button
        type="button"
        onClick={copyLink}
        className="flex-1 rounded border border-line px-4 py-2.5 text-center font-mono text-sm font-bold transition hover:border-muted"
      >
        {copied ? 'COPIED!' : 'COPY LINK'}
      </button>
    </div>
  );
}
