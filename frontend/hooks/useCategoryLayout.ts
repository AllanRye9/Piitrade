'use client';

import { useSiteConfig } from '@/context/SiteConfigContext';

/**
 * Admin-controlled category layout (Admin → Category layout, stored in generalSettings):
 *  - `rank`: top-level category slugs in the order buyers should see them (partial lists are fine;
 *    anything not listed follows in the default order).
 *  - `hidden`: top-level slugs an admin wants kept off buyer surfaces (nav, home, search, filters).
 *    Hidden categories stay available to sellers in the post form and to direct links.
 * Both are empty until an admin saves something, which leaves today's behaviour unchanged.
 */
export function useCategoryLayout() {
  const { categoryRank, hiddenCategories } = useSiteConfig();
  return { rank: categoryRank ?? [], hidden: hiddenCategories ?? [] };
}
