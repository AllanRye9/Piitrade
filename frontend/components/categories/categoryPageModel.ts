/**
 * Pure model for the generic category page (/category/<slug>): subcategory tiles grouped by
 * menuGroup, and the breadcrumb trail. Subcategories with no live listings are not shown to buyers
 * (Jobs/CV trees are exempt, as everywhere else).
 */
import { subcategoryHref } from '@/lib/categoryLinks';
import { isBuyerVisible, type CountMap } from '@/lib/categoryVisibility';

export interface PageCategory {
  id?: string;
  name: string;
  slug: string;
  icon?: string | null;
  shortName?: string | null;
  menuGroup?: string | null;
}

export interface PageTile { slug: string; name: string; label: string; icon: string; count: number | null; href: string }
export interface TileGroup { heading: string | null; tiles: PageTile[] }

/**
 * Children arrive already ordered (sortOrder, then name). Groups keep the order of their first
 * member; subcategories without a menuGroup form a trailing heading-less group.
 */
export function buildTileGroups(
  children: PageCategory[] | null | undefined,
  counts: CountMap,
  parentSlug: string,
  parentIcon?: string | null,
): TileGroup[] {
  const groups = new Map<string, PageTile[]>();
  const ungrouped: PageTile[] = [];
  for (const c of children ?? []) {
    if (!isBuyerVisible(c.slug, counts, parentSlug)) continue;
    const tile: PageTile = {
      slug: c.slug,
      name: c.name,
      label: c.shortName || c.name,
      icon: c.icon || parentIcon || '📦',
      count: counts ? (counts[c.slug] ?? 0) : null,
      href: subcategoryHref(c.slug),
    };
    if (c.menuGroup) {
      const list = groups.get(c.menuGroup) ?? [];
      list.push(tile);
      groups.set(c.menuGroup, list);
    } else {
      ungrouped.push(tile);
    }
  }
  const out: TileGroup[] = [...groups.entries()].map(([heading, tiles]) => ({ heading, tiles }));
  if (ungrouped.length > 0) out.push({ heading: groups.size > 0 ? 'More' : null, tiles: ungrouped });
  return out;
}

export interface Crumb { label: string; href: string | null }

export function buildBreadcrumb(
  category: { name: string; slug: string },
  parent: { name: string; slug: string } | null | undefined,
  parentHref: (slug: string) => string,
): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Home', href: '/' }, { label: 'All categories', href: '/categories' }];
  if (parent) crumbs.push({ label: parent.name, href: parentHref(parent.slug) });
  crumbs.push({ label: category.name, href: null });
  return crumbs;
}
