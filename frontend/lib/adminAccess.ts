import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface AdminPermissionInfo { key: string; label: string }
export interface AdminMe {
  isPrimaryAdmin: boolean;
  /** Permission keys this admin may use (the primary admin has all of them). */
  permissions: string[];
  allPermissions: AdminPermissionInfo[];
}

/** Which permission (or 'primary') each admin page needs. Pages not listed are open to every admin. */
export const ADMIN_PAGE_ACCESS: Record<string, string> = {
  '/admin/analytics': 'analytics', '/admin/visitor-logs': 'analytics', '/admin/search-logs': 'analytics', '/admin/click-logs': 'analytics',
  '/admin/listings': 'listings', '/admin/bulk-post': 'listings', '/admin/images': 'listings', '/admin/reviews': 'listings', '/admin/reports': 'listings', '/admin/jobs': 'listings',
  '/admin/homepage-layout': 'content', '/admin/categories': 'content', '/admin/category-layout': 'content', '/admin/category-structure': 'content', '/admin/blog': 'content',
  '/admin/media': 'content', '/admin/translations': 'content', '/admin/currency-rates': 'content', '/admin/commodity-prices': 'content', '/admin/farmer-marketplace': 'content',
  '/admin/partners': 'stores', '/admin/webstores': 'stores', '/admin/store-rentals': 'stores',
  '/admin/users': 'users', '/admin/kyc': 'users', '/admin/cv-history': 'users',
  '/admin/packages': 'payments', '/admin/subscriptions': 'payments', '/admin/payments': 'payments', '/admin/transactions': 'payments', '/admin/submissions': 'payments',
  '/admin/settings': 'settings', '/admin/support-requests': 'support',
  '/admin/backup': 'primary', '/admin/admins': 'primary',
};

export function canSeeAdminPage(me: AdminMe, href: string): boolean {
  const need = ADMIN_PAGE_ACCESS[href];
  if (!need || me.isPrimaryAdmin) return true;
  return need !== 'primary' && me.permissions.includes(need);
}

/** Page-level check for any admin URL (matches sub-pages too, e.g. /admin/users/123). Unlisted pages are open. */
export function canAccessAdminPath(me: AdminMe, pathname: string): boolean {
  if (me.isPrimaryAdmin) return true;
  const key = Object.keys(ADMIN_PAGE_ACCESS).find((k) => pathname === k || pathname.startsWith(`${k}/`));
  if (!key) return true;
  const need = ADMIN_PAGE_ACCESS[key];
  return need !== 'primary' && me.permissions.includes(need);
}

/** The signed-in admin's role (primary / secondary) and granted areas. `null` while loading; `undefined` if the check failed. */
export function useAdminMe(enabled = true): AdminMe | null | undefined {
  const [me, setMe] = useState<AdminMe | null | undefined>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.get('/admin/me')
      .then(({ data }) => { if (alive) setMe(data as AdminMe); })
      .catch(() => { if (alive) setMe(undefined); });
    return () => { alive = false; };
  }, [enabled]);
  return me;
}
