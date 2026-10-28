/**
 * Where a category link should go.
 *
 * Top-level categories with a hand-made storefront page link there. Everything else (every new
 * top-level category and every subcategory) uses the generic, API-driven page /category/<slug>
 * (app/category/[slug]), which needs no code change per category. That page links on to the full
 * filter view /listings?category=<slug>. Keep DEDICATED_CATEGORY_PAGES in sync with the folders under
 * app/ that are hand-made category storefronts.
 */
export const DEDICATED_CATEGORY_PAGES: ReadonlySet<string> = new Set([
  'motors', 'property', 'jobs', 'cv-services', 'classifieds', 'electronics', 'fashion',
  'furniture', 'garden', 'services', 'agriculture', 'fine-jewellery', 'arts-collectibles',
]);

export function categoryHref(slug: string): string {
  return DEDICATED_CATEGORY_PAGES.has(slug) ? `/${slug}` : `/category/${encodeURIComponent(slug)}`;
}

/** Subcategories use the generic category page. */
export function subcategoryHref(slug: string): string {
  return `/category/${encodeURIComponent(slug)}`;
}

/** The full filter / sort view for any category slug. */
export function categoryListingsHref(slug: string): string {
  return `/listings?category=${encodeURIComponent(slug)}`;
}
