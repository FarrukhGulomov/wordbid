import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';

// This queries the database, which is unreachable from the isolated container most hosts
// (Railway, Vercel, ...) build in — force-dynamic skips static generation at build time and
// renders this on request instead, which also keeps it correctly up to date at all times.
export const dynamic = 'force-dynamic';

/** Every owned word gets an indexable page — that is the SEO surface of the product. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const words = await prisma.word.findMany({
    where: { blocked: false, currentOwnershipId: { not: null } },
    select: { normalized: true, ownedSince: true },
    orderBy: { valueCents: 'desc' },
    take: 5000,
  });

  return [
    { url: config.siteUrl, changeFrequency: 'hourly', priority: 1 },
    { url: `${config.siteUrl}/claim`, changeFrequency: 'weekly', priority: 0.8 },
    ...words.map((word) => ({
      url: `${config.siteUrl}/word/${word.normalized}`,
      lastModified: word.ownedSince ?? undefined,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
  ];
}
