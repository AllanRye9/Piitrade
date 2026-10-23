/**
 * Header-search category suggestions must not lead a buyer to an empty page. With ~290 categories
 * (most new ones start with zero listings) a name match alone is no longer a good enough signal, so
 * suggestions are limited to categories that currently hold at least one live listing.
 *
 * Jobs (backed by JobPost rows) and CV Services (static tools) are not listing-driven, so their
 * trees are exempt, matching the visibility rule used by the frontend (lib/categoryVisibility.ts).
 */
export const UNGATED_TREES: ReadonlySet<string> = new Set(['jobs', 'cv-services']);

export interface SuggestableCategory {
  name: string;
  slug: string;
  parent?: { name: string; slug: string } | null;
}

/**
 * @param counts rolled-up live listing counts per slug (see utils/categoryCounts.ts). `null` means
 *               the counts could not be loaded: fail open and keep every match.
 */
export function filterSuggestableCategories<T extends SuggestableCategory>(
  categories: T[],
  counts: Record<string, number> | null | undefined,
  limit = 4,
): T[] {
  if (!counts) return categories.slice(0, limit);
  return categories
    .filter((c) => {
      if (UNGATED_TREES.has(c.slug) || (c.parent && UNGATED_TREES.has(c.parent.slug))) return true;
      return (counts[c.slug] ?? 0) > 0;
    })
    .slice(0, limit);
}
