import Link from 'next/link';

// A custom not-found page, not Next's default — its only real job here is carrying
// `force-dynamic`, so it doesn't get statically prerendered at build time and freeze the
// header's live online/visitor numbers into a 404 page forever until the next deploy.
export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="font-mono text-xs tracking-widest text-muted">404</p>
      <h1 className="mt-3 font-mono text-2xl font-black tracking-tight">NOBODY OWNS THIS PAGE</h1>
      <p className="mt-4 text-muted">There&rsquo;s nothing here.</p>
      <Link
        href="/"
        className="mt-8 inline-block rounded bg-gold px-4 py-2.5 font-mono text-sm font-bold text-ink transition hover:opacity-85"
      >
        SEE WHO OWNS THE INTERNET
      </Link>
    </div>
  );
}
