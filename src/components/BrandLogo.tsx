'use client';

import { useState } from 'react';

/**
 * Owner favicon. Many sites have none, and the resolver can fail, so a logo that does not
 * load removes itself rather than leaving a broken-image gap in the layout.
 */
export function BrandLogo({
  src,
  size = 16,
  className = '',
}: {
  src: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-sm ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
