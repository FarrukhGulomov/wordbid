import type { Metadata } from 'next';
import Link from 'next/link';
import { WordSearch } from '@/components/WordSearch';

// A custom not-found page, not Next's default — its only real job here is carrying
// `force-dynamic`, so it doesn't get statically prerendered at build time and freeze the
// header's live online/visitor numbers into a 404 page forever until the next deploy.
export const dynamic = 'force-dynamic';

// Without this the 404 inherited the root layout's default title, so a mistyped word and the
// homepage were indistinguishable in the tab, in history and in a bookmark.
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="font-mono text-xs tracking-widest text-muted">404</p>
      <h1 className="mt-3 font-mono text-2xl font-black tracking-tight">NOBODY OWNS THIS PAGE</h1>
      <p className="mt-4 text-muted">
        There&rsquo;s nothing here. Most people land on this page after a mistyped word — try it
        again below.
      </p>

      {/* The likeliest reason anyone reaches a 404 here is a word URL that doesn't exist, and
          on this site every word is claimable. So the next action is the same input the homepage
          leads with, not just a link back to the top of the funnel. */}
      <div className="mx-auto mt-8 max-w-sm text-left">
        <WordSearch />
      </div>

      <Link
        href="/"
        className="mt-6 inline-flex min-h-8 items-center text-sm text-muted underline underline-offset-2 hover:text-text"
      >
        See who owns the internet →
      </Link>
    </div>
  );
}
