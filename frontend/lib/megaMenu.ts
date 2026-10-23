/**
 * Mega-menu column builder (Phase 0 capacity budget).
 *
 * - Curated (hand-made) columns are kept, each capped at `maxPerColumn` links.
 * - Live subcategories the curated list does not already link to are added as ONE extra column,
 *   most-populated first, capped at `maxExtra`. Only subcategories with confirmed live listings
 *   are added, so a brand-new, still-empty subcategory never appears in the menu.
 * - Extras link to /listings?category=<slug>, which works for every category without needing a
 *   per-subcategory page.
 */
import { UNGATED_TREES, isConfirmedLive } from '@/lib/categoryVisibility';

export interface MegaLink { label: string; href: string; countSlug?: string }
export interface MegaColumn { heading: string; links: MegaLink[] }

export interface BuildMegaOptions {
  parentSlug: string;
  /** Maps a curated link href to its category slug (or null if it is not a plain category route). */
  linkSlugOf: (href: string) => string | null;
  extraHeading: string;
  maxPerColumn?: number;
  maxExtra?: number;
}

export function buildMegaColumns(
  curated: MegaColumn[],
  children: { name: string; slug: string }[] | null | undefined,
  counts: Record<string, number> | null | undefined,
  opts: BuildMegaOptions,
): MegaColumn[] {
  const maxPerColumn = opts.maxPerColumn ?? 8;
  const maxExtra = opts.maxExtra ?? 8;
  const columns = curated.map((c) => ({ ...c, links: c.links.slice(0, maxPerColumn) }));

  if (!children || !counts || UNGATED_TREES.has(opts.parentSlug)) return columns;

  const known = new Set<string>();
  for (const c of curated) for (const l of c.links) {
    const s = opts.linkSlugOf(l.href);
    if (s) known.add(s);
  }

  const extras = children
    .filter((ch) => !known.has(ch.slug) && isConfirmedLive(ch.slug, counts))
    .sort((a, b) => (counts[b.slug] ?? 0) - (counts[a.slug] ?? 0) || a.name.localeCompare(b.name))
    .slice(0, maxExtra)
    .map((ch): MegaLink => ({ label: ch.name, href: `/listings?category=${encodeURIComponent(ch.slug)}`, countSlug: ch.slug }));

  if (extras.length > 0) columns.push({ heading: opts.extraHeading, links: extras });
  return columns;
}
