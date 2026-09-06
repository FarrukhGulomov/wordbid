import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { config, SITE_NAME } from '@/lib/config';
import { getOnlineCount, getTotalVisitors } from '@/lib/attention';
import { formatCount } from '@/lib/money';
import { VisitorHeartbeat } from '@/components/VisitorHeartbeat';

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: {
    default: `${SITE_NAME} — See who's getting attention on the internet.`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    'Rank is bought. Attention is real. Brands compete for a word and a position — see who is actually getting clicked and visited.',
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — See who's getting attention on the internet.`,
    description: "Rank is bought. Attention is real — see who's actually getting clicked and visited.",
    images: [{ url: '/og-image-1200x630.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-image-1200x630.png'],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Real numbers only — see src/lib/attention.ts. Fetched here so every page carries the same
  // proof line; this is also why every page in this app renders dynamically.
  const [online, visitors] = await Promise.all([getOnlineCount(), getTotalVisitors()]);

  return (
    <html lang="en">
      <body className="min-h-screen">
        <VisitorHeartbeat />

        <header className="border-b border-line">
          <div className="mx-auto max-w-3xl px-4 py-3 sm:py-4">
            {/* Hierarchy is BRAND -> CTA -> live stats: the wordmark anchors the left at real
                size instead of apologizing for itself; stats and the CTA are grouped on the
                right so stats read as supporting context for the action next to them, not as
                a third, equally-weighted header item competing for center attention. */}
            <div className="flex items-center justify-between gap-4">
              <Link href="/" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-horizontal.svg" alt={SITE_NAME} className="h-8 w-auto sm:h-9" />
              </Link>
              <div className="flex items-center gap-4">
                {/* Desktop: same proof line, folded into the header's one row instead of a
                    second line — keeps the header compact so the product starts sooner. */}
                <p className="tnum hidden font-mono text-xs text-muted sm:block">
                  <span className="text-live">🟢</span> {formatCount(online)} online ·{' '}
                  {formatCount(visitors)} visitors ·{' '}
                  <Link href="/stats" className="text-muted underline underline-offset-2 hover:text-text">
                    STATS →
                  </Link>
                </p>
                <Link
                  href="/claim"
                  className="shrink-0 rounded bg-gold px-4 py-2 font-mono text-sm font-bold text-ink transition hover:opacity-85"
                >
                  CLAIM A WORD
                </Link>
              </div>
            </div>
            <p className="tnum mt-1.5 font-mono text-xs text-muted sm:hidden">
              <span className="text-live">🟢</span> {formatCount(online)} online ·{' '}
              {formatCount(visitors)} visitors ·{' '}
              <Link href="/stats" className="text-muted underline underline-offset-2 hover:text-text">
                STATS →
              </Link>
            </p>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-4 pb-16">{children}</main>

        <footer className="border-t border-line">
          <div className="mx-auto max-w-3xl space-y-3 px-4 py-8 text-xs text-muted">
            <p>
              <strong className="text-text">Paid placement.</strong> Positions on this site are
              bought, not earned. Rank is decided by how much the current owner paid — it is not a
              measure of quality, popularity or trustworthiness.
            </p>
            <p>
              Owning a word here is temporary placement on this platform only. It is not legal
              ownership of a word, a trademark, a domain or any intellectual property.
            </p>
            <p className="flex gap-4 pt-2">
              <Link href="/stats" className="underline underline-offset-2 hover:text-text">
                Stats
              </Link>
              <Link href="/terms" className="underline underline-offset-2 hover:text-text">
                Terms
              </Link>
              <Link href="/claim" className="underline underline-offset-2 hover:text-text">
                Claim a word
              </Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
