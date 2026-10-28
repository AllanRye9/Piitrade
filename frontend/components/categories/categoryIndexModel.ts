/**
 * Pure model for the /categories index page: which top-level categories to show, in what order, and
 * which subcategory chips each card gets. Kept free of React so it is unit-testable.
 */
import { categoryHref, subcategoryHref } from '@/lib/categoryLinks';
import { findSynonymSlugs } from '@/lib/categorySynonyms';
import {
  UNGATED_TREES, compareByRankThenCount, effectiveRank, isAdminHidden, isBuyerVisible, type CountMap,
} from '@/lib/categoryVisibility';

export interface TreeNode { id?: string; name: string; slug: string; shortName?: string | null; icon?: string | null; children?: TreeNode[] }

export interface IndexChip { name: string; slug: string; href: string; count: number }
export interface IndexCard {
  slug: string;
  name: string;
  icon: string;
  href: string;
  count: number | null;
  chips: IndexChip[];
  /** live subcategories not shown as chips (drives the "See all N" link) */
  hiddenChips: number;
}

export interface BuildIndexInput {
  tree: TreeNode[] | null | undefined;
  counts: CountMap;
  configRank?: readonly string[] | null;
  hidden?: readonly string[] | null;
  query?: string;
  /** chips per card when not searching */
  maxChips?: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function buildIndexCards({ tree, counts, configRank, hidden, query = '', maxChips = 6 }: BuildIndexInput): IndexCard[] {
  if (!tree) return [];
  const rank = effectiveRank(configRank);
  const q = norm(query);
  const synonymSlugs = new Set(findSynonymSlugs(q));

  const parents = tree
    .filter((p) => !isAdminHidden(p.slug, hidden) && isBuyerVisible(p.slug, counts))
    .sort((a, b) => compareByRankThenCount(a, b, counts, rank));

  const cards: IndexCard[] = [];
  for (const p of parents) {
    const ungated = UNGATED_TREES.has(p.slug);
    const liveChildren = ungated
      ? []
      : (p.children ?? [])
          .filter((c) => isBuyerVisible(c.slug, counts, p.slug))
          .sort((a, b) => (counts?.[b.slug] ?? 0) - (counts?.[a.slug] ?? 0) || a.name.localeCompare(b.name));

    let shown = liveChildren;
    if (q) {
      const parentMatches = norm(p.name).includes(q) || synonymSlugs.has(p.slug);
      const matchingChildren = liveChildren.filter((c) => norm(c.name).includes(q) || synonymSlugs.has(c.slug));
      if (!parentMatches && matchingChildren.length === 0) continue;
      shown = matchingChildren.length > 0 ? matchingChildren : liveChildren.slice(0, maxChips);
    } else {
      shown = liveChildren.slice(0, maxChips);
    }

    cards.push({
      slug: p.slug,
      name: p.name,
      icon: p.icon || '📦',
      href: categoryHref(p.slug),
      count: counts ? (counts[p.slug] ?? 0) : null,
      chips: shown.map((c) => ({ name: c.shortName || c.name, slug: c.slug, href: subcategoryHref(c.slug), count: counts?.[c.slug] ?? 0 })),
      hiddenChips: Math.max(0, liveChildren.length - shown.length),
    });
  }
  return cards;
}
