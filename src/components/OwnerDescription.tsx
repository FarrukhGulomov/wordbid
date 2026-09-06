/**
 * The current owner's website description, shown only when a trustworthy one is stored —
 * never a placeholder like "No description available." when there isn't one. Text is rendered
 * as a normal React child, so it is HTML-escaped automatically regardless of what the source
 * site's metadata contained.
 *
 * Capped to 3 visual lines so an unusually long stored description (already bounded to 160
 * characters at fetch time — see src/lib/site-metadata.ts) can never push the owner card taller
 * or compete visually with the owner name above it.
 */
export function OwnerDescription({ description }: { description: string | null }) {
  if (!description) return null;

  return <p className="mt-1 line-clamp-3 text-xs leading-snug text-muted">{description}</p>;
}
