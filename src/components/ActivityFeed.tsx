import Link from 'next/link';
import { formatUsd } from '@/lib/money';
import { shortAgo } from '@/lib/time';

type Entry = {
  id: string;
  type: 'CLAIMED' | 'TAKEOVER';
  amountCents: number;
  previousOwnerName: string | null;
  createdAt: Date;
  word: { display: string; normalized: string };
  owner: { name: string };
};

/** Compact recent-activity strip. Present enough to feel alive, small enough not to compete. */
export function ActivityFeed({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-muted">
        <span className="text-live">⚡</span> LIVE
      </h2>
      <ul className="divide-y divide-line rounded border border-line bg-surface">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-baseline gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{entry.owner.name}</span>{' '}
              <span className="text-muted">{entry.type === 'TAKEOVER' ? 'took' : 'claimed'}</span>{' '}
              <Link
                href={`/word/${entry.word.normalized}`}
                className="font-mono font-bold uppercase hover:text-gold"
              >
                {entry.word.display}
              </Link>
            </span>
            <span className="tnum shrink-0 font-mono text-xs text-gold">
              {formatUsd(entry.amountCents)}
            </span>
            <span className="tnum w-8 shrink-0 text-right text-xs text-muted">
              {shortAgo(entry.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
