/**
 * Builds the list of category tiles for the home page (desktop row and mobile grid).
 *
 * Starts from the hand-made HOME_CATEGORIES (which carry badges and taglines), adds any live
 * top-level category that has no hand-made tile (Health & Beauty, Food, Building, Energy, …), drops
 * what buyers shouldn't see (no live listings, or hidden by an admin), and orders the result by the
 * admin rank (default Uganda rank when none is set). Pure, so it can be unit-tested.
 */
import type { HomeCategory } from '@/lib/homeCategories';
import { categoryHref } from '@/lib/categoryLinks';
import {
  compareByRankThenCount, effectiveRank, isAdminHidden, isBuyerVisible, isConfirmedLive, type CountMap,
} from '@/lib/categoryVisibility';

export interface TreeParent { slug: string; name: string; shortName?: string | null; icon?: string | null }

export interface HomeTilesInput {
  base: HomeCategory[];
  tree: TreeParent[] | null | undefined;
  counts: CountMap;
  configRank?: readonly string[] | null;
  hidden?: readonly string[] | null;
}

function slugOfTile(t: HomeCategory): string {
  return t.countKey ?? t.href.replace(/^\//, '').split(/[?/]/)[0];
}

export function buildHomeTiles({ base, tree, counts, configRank, hidden }: HomeTilesInput): HomeCategory[] {
  const rank = effectiveRank(configRank);
  const have = new Set(base.map(slugOfTile));

  const live = base.filter((t) => {
    const slug = slugOfTile(t);
    if (isAdminHidden(slug, hidden)) return false;
    // alwaysShow tiles (Services, Classifieds) stay on the home page even with 0 live listings.
    return t.alwaysShow || t.countKey === null || isBuyerVisible(t.countKey, counts);
  });

  const extras: HomeCategory[] = (tree ?? [])
    .filter((p) => !have.has(p.slug) && !isAdminHidden(p.slug, hidden) && isConfirmedLive(p.slug, counts))
    .map((p) => ({
      label: p.shortName || p.name,
      icon: p.icon || '📦',
      href: categoryHref(p.slug),
      countKey: p.slug,
    }));

  const all = [...live, ...extras];
  return all
    .map((t, i) => ({ t, i }))
    .sort((a, b) => compareByRankThenCount(
      { slug: slugOfTile(a.t), name: a.t.label },
      { slug: slugOfTile(b.t), name: b.t.label },
      counts,
      rank,
    ) || a.i - b.i)
    .map((x) => x.t);
}
