'use client';

import { useEffect, useState } from 'react';

/**
 * Owner avatar: a monogram tile, replaced by the real favicon once that favicon is known to load.
 *
 * Two things this must never do. It must never change size — returning null on a missing icon
 * (the old behaviour) slid the brand name left by the tile's whole width on every logo-less row,
 * so a column that should read as one straight edge came out ragged, and the same page laid out
 * differently for a visitor whose blocker killed the request. And it must never show the
 * browser's broken-image glyph.
 *
 * The glyph is why the image is not simply server-rendered with an onError handler: a request
 * that fails before React hydrates fires its error event with nobody listening, and the glyph
 * then stays on screen. So the monogram is what the server renders and what the first client
 * render paints, and the <img> only ever appears after an off-document preload has actually
 * decoded it. A logo that cannot load is therefore invisible rather than broken, and the tile it
 * would have occupied is already the right size and already filled.
 */
export function BrandLogo({
  src,
  name,
  size = 16,
  className = '',
}: {
  src: string | null;
  /** Owner's brand name — only its first character is used, for the monogram. */
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!src) return;
    setLoaded(false);
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled) setLoaded(true);
    };
    probe.src = src;
    // Served from cache, the load event can fire before onload is attached.
    if (probe.complete && probe.naturalWidth > 0) setLoaded(true);
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (src && loaded) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-sm ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const initial = (name ?? '').trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2 font-mono font-bold text-muted ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.45)) }}
    >
      {initial || '·'}
    </span>
  );
}
