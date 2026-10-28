/**
 * Buyer-facing category visibility rules (Phase 0 of the Uganda category expansion).
 *
 * Two audiences, two rules (see UGANDA_CATEGORY_EXPANSION.md §12.1):
 *  - SELLER surfaces (post form, bulk post, admin) always show the full tree. Never use this file there.
 *  - BUYER surfaces (nav, search, filters) only show a category that has live listings, so the
 *    ~290 categories can exist without producing empty pages.
 *
 * `counts` is the rolled-up map from GET /categories/rollup-counts or /categories/counts:
 * counts[slug] = live listings in that category INCLUDING its subcategories; a missing key means 0.
 */

export type CountMap = Record<string, number> | null | undefined;

/**
 * Trees that are not backed by listing counts: Jobs is backed by JobPost rows and CV Services is a
 * set of static tools. Their counts say nothing about whether their pages have content, so they are
 * never count-gated (same rule as CategoryBar's LISTING_DRIVEN_CATEGORIES).
 */
export const UNGATED_TREES: ReadonlySet<string> = new Set(['jobs', 'cv-services']);

/**
 * Default display rank for top-level categories on buyer surfaces (Uganda starting order, a
 * judgement to be re-ranked from search logs). Slugs not listed sort after these, by live count.
 */
export const DEFAULT_PARENT_RANK: readonly string[] = [
  'motors', 'property', 'electronics', 'fashion', 'jobs', 'services', 'agriculture',
  'building-construction', 'food-groceries', 'classifieds', 'furniture', 'energy-power',
  'health-beauty', 'industrial-business', 'events-entertainment', 'education-training',
  'pets-animals', 'travel-tourism', 'garden', 'arts-collectibles', 'fine-jewellery', 'cv-services',
];

/**
 * Should a buyer see this category?
 * - counts unknown (loading / failed): fail open (true), so a network blip never hides everything.
 * - Jobs / CV trees: always true.
 * - otherwise: only with at least one live listing.
 */
export function isBuyerVisible(slug: string, counts: CountMap, parentSlug?: string | null): boolean {
  if (!counts) return true;
  if (UNGATED_TREES.has(slug) || (parentSlug && UNGATED_TREES.has(parentSlug))) return true;
  return (counts[slug] ?? 0) > 0;
}

/**
 * STRICT variant for additive surfaces ("More" menu extras, mega-menu extras): unknown counts mean
 * hidden, because these entries are extra to a hand-made list and must never appear while empty.
 */
export function isConfirmedLive(slug: string, counts: CountMap): boolean {
  return !!counts && (counts[slug] ?? 0) > 0;
}

/** Sort comparator: DEFAULT_PARENT_RANK first, then live count (desc), then name. */
export function compareByRankThenCount(
  a: { slug: string; name: string },
  b: { slug: string; name: string },
  counts: CountMap,
  rank: readonly string[] = DEFAULT_PARENT_RANK,
): number {
  const ia = rank.indexOf(a.slug);
  const ib = rank.indexOf(b.slug);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  const dc = (counts?.[b.slug] ?? 0) - (counts?.[a.slug] ?? 0);
  return dc !== 0 ? dc : a.name.localeCompare(b.name);
}

export interface SelectOption { value: string; label: string }

/**
 * Options for the header search category <select>. Until both the tree and the counts have loaded
 * the hand-made fallback list is used (so the dropdown never flashes 22 mostly-empty entries);
 * afterwards it is built from the API: buyer-visible top-level categories in rank order.
 */
export function buildCategoryOptions(
  fallback: SelectOption[],
  tree: { slug: string; name: string }[] | null | undefined,
  counts: CountMap,
  keepSlug?: string,
  layout?: { rank?: readonly string[] | null; hidden?: readonly string[] | null },
): SelectOption[] {
  if (!tree || tree.length === 0 || !counts) return fallback;
  const rank = effectiveRank(layout?.rank);
  const parents = tree
    .filter((p) => p.slug === keepSlug || (!isAdminHidden(p.slug, layout?.hidden) && isBuyerVisible(p.slug, counts)))
    .sort((a, b) => compareByRankThenCount(a, b, counts, rank));
  const head = fallback.find((o) => o.value === '') ?? { value: '', label: 'All Categories' };
  return [head, ...parents.map((p) => ({ value: p.slug, label: p.name }))];
}

// ── Admin-controlled order and hiding (Admin → Category layout) ────────────────────────────────

/**
 * The rank to use: the admin's order first (if any), then the default order for anything the admin
 * did not mention, so a partial list never drops categories.
 */
export function effectiveRank(configRank: readonly string[] | null | undefined): string[] {
  const admin = (configRank ?? []).filter(Boolean);
  const seen = new Set(admin);
  return [...admin, ...DEFAULT_PARENT_RANK.filter((s) => !seen.has(s))];
}

/** True when an admin chose to hide this top-level category from buyer surfaces. */
export function isAdminHidden(slug: string, hidden: readonly string[] | null | undefined): boolean {
  return !!hidden && hidden.includes(slug);
}

/**
 * Stable re-order by the admin rank. Items whose slug is not in the list keep their relative order
 * and follow the ranked ones. With an empty rank the input order is returned unchanged.
 */
export function sortByAdminRank<T>(
  items: T[],
  slugOf: (item: T) => string,
  configRank: readonly string[] | null | undefined,
): T[] {
  const rank = (configRank ?? []).filter(Boolean);
  if (rank.length === 0) return items;
  const idx = (s: string) => { const i = rank.indexOf(s); return i === -1 ? Number.POSITIVE_INFINITY : i; };
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ia = idx(slugOf(a.item));
      const ib = idx(slugOf(b.item));
      if (ia === ib) return a.i - b.i; // same rank (incl. both unranked) -> keep original order
      return ia < ib ? -1 : 1;
    })
    .map((x) => x.item);
}
