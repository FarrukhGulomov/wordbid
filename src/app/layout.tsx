import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { config, SITE_NAME } from '@/lib/config';

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: {
    default: `${SITE_NAME} — Claim a word. Own a position.`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    'Brands compete to own a word and a position on the internet. Highest current value ranks #1.',
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Claim a word. Own a position.`,
    description: 'Brands compete to own a word and a position on the internet.',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
            <Link href="/" className="font-mono text-sm font-bold tracking-tight">
              👑 OWN<span className="text-gold">THE</span>INTERNET
            </Link>
            <Link
              href="/claim"
              className="rounded bg-gold px-3 py-1.5 font-mono text-xs font-bold text-ink transition hover:opacity-85"
            >
              CLAIM A WORD
            </Link>
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
