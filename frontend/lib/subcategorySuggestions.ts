/**
 * Header-search suggestions for subcategories, built from the live category tree instead of the old
 * hand-made mega-menu index. Only categories a buyer can actually see are suggested: subcategories
 * with live listings, under top-level categories an admin has not hidden. Matches by name, short
 * name and the shared synonym list ("matatu" -> Vans & Minibuses).
 */
import { findSynonymSlugs } from '@/lib/categorySynonyms';
import { isAdminHidden, isBuyerVisible, type CountMap } from '@/lib/categoryVisibility';

export interface SuggestParent {
  slug: string;
  name: string;
  children?: { slug: string; name: string; shortName?: string | null }[];
}

export interface SubcategorySuggestion { label: string; categorySlug: string; q: string }

export function buildSubcategorySuggestions(
  tree: SuggestParent[] | null | undefined,
  counts: CountMap,
  term: string,
  hidden?: readonly string[] | null,
  limit = 6,
): SubcategorySuggestion[] {
  const t = term.trim().toLowerCase();
  if (!tree || !counts || t.length < 1) return [];
  const synonymSlugs = new Set(findSynonymSlugs(t));
  const out: SubcategorySuggestion[] = [];
  for (const parent of tree) {
    if (isAdminHidden(parent.slug, hidden) || !isBuyerVisible(parent.slug, counts)) continue;
    for (const child of parent.children ?? []) {
      if (!isBuyerVisible(child.slug, counts, parent.slug)) continue;
      const hit =
        child.name.toLowerCase().includes(t) ||
        (child.shortName ?? '').toLowerCase().includes(t) ||
        synonymSlugs.has(child.slug);
      if (!hit) continue;
      out.push({ label: child.name, categorySlug: parent.slug, q: child.name });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
