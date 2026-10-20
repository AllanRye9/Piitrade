/**
 * Top-level categories shown as icon tiles on the home page (mobile icon grid
 * and the desktop/tablet "Browse by category" row). Hrefs match CategoryBar so
 * a tile lands on the same page as the header tab.
 *
 * `countKey` is the category slug in GET /categories/rollup-counts, or null
 * where a count would be meaningless (CV tools are not listings).
 */
export interface HomeCategory {
  label: string;
  /** Shorter label for the 4-up mobile grid. */
  shortLabel?: string;
  icon: string;
  href: string;
  countKey: string | null;
  /** Shown instead of a count when countKey is null. */
  tagline?: string;
  badge?: string;
  /** Included in the mobile 4x2 grid. */
  mobile: boolean;
}

export const HOME_CATEGORIES: HomeCategory[] = [
  { label: 'Motors', icon: '🚗', href: '/motors', countKey: 'motors', badge: 'Hot', mobile: true },
  { label: 'Property', icon: '🏠', href: '/property', countKey: 'property', mobile: true },
  { label: 'Electronics', icon: '💻', href: '/electronics', countKey: 'electronics', mobile: true },
  { label: 'Fashion', icon: '👗', href: '/fashion', countKey: 'fashion', mobile: true },
  { label: 'Jobs', icon: '💼', href: '/jobs', countKey: 'jobs', mobile: true },
  { label: 'Services', icon: '🔧', href: '/services', countKey: 'services', mobile: true },
  { label: 'Furniture', icon: '🛋️', href: '/furniture', countKey: 'furniture', mobile: true },
  { label: 'Classifieds', icon: '📋', href: '/classifieds', countKey: 'classifieds', mobile: true },
  { label: 'Garden', icon: '🌿', href: '/garden', countKey: 'garden', mobile: false },
  { label: 'Agriculture', icon: '🌾', href: '/agriculture', countKey: 'agriculture', mobile: false },
  { label: 'CV Services', icon: '📄', href: '/cv-services', countKey: null, tagline: 'Career tools', mobile: false },
];
