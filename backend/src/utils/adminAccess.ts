/**
 * adminAccess.ts — primary vs secondary administrators.
 *
 *   • The PRIMARY admin (User.isPrimaryAdmin, exactly one — enforced by a partial unique index) is the first
 *     administrator. Has every permission, and alone can: promote/demote/ban other admins, grant or change
 *     secondary admins' permissions, hand the primary role to another admin, restore backups and flip the
 *     payment switches.
 *   • SECONDARY admins (every other role=ADMIN) can only use the areas the primary admin has granted them
 *     (User.adminPermissions). A new secondary admin starts with none.
 *
 * Enforcement is central: middleware `authorize('ADMIN')` asks `requiredAdminAccess()` for the request's path.
 * Anything not listed here is PRIMARY-ONLY (default deny), so a new admin endpoint is safe until it is mapped.
 */

export const ADMIN_PERMISSIONS = ['analytics', 'listings', 'content', 'users', 'payments', 'stores', 'support', 'settings'] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  analytics: 'Analytics & logs',
  listings: 'Listings, images, reports & reviews',
  content: 'Content: categories, layout, media, blog, translations, prices',
  users: 'Users, KYC & CV history',
  payments: 'Packages, subscriptions, transactions & MoMo payments',
  stores: 'Merchants, partners & store rentals',
  support: 'Support requests & CV service requests',
  settings: 'Site settings, tier pricing & WhatsApp',
};

export function isAdminPermission(v: unknown): v is AdminPermission {
  return typeof v === 'string' && (ADMIN_PERMISSIONS as readonly string[]).includes(v);
}

/** Keeps only known, de-duplicated permission keys. */
export function sanitizePermissions(input: unknown): AdminPermission[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.filter(isAdminPermission)));
}

export type RequiredAccess = 'any' | 'primary' | AdminPermission;

// First match wins, so put the specific rules before the general ones. Matched against "/api/..." without the query string.
const RULES: Array<[RegExp, RequiredAccess]> = [
  // ── Primary admin only ──
  [/^\/api\/admin\/backup(\/|$)/, 'primary'],
  [/^\/api\/admin\/admins(\/|$)/, 'primary'],
  [/^\/api\/admin\/users\/admin-approval-audit$/, 'primary'],
  [/^\/api\/admin\/users\/[^/]+\/approve-admin$/, 'primary'],
  [/^\/api\/payments\/admin\/(status|switch|airtel)(\/|$)/, 'primary'],
  // ── Any admin ──
  [/^\/api\/admin\/me$/, 'any'],
  // ── Granted areas ──
  [/^\/api\/admin\/(analytics|visitor-logs|search-logs|click-logs|stats|alerts|logs)(\/|$)/, 'analytics'],
  [/^\/api\/(stats|live\/admin)(\/|$)/, 'analytics'],
  [/^\/api\/admin\/(listings|images|reports|reviews)(\/|$)/, 'listings'],
  [/^\/api\/upload\/candidates$/, 'listings'],
  [/^\/api\/admin\/site-config\/(tier-pricing|whatsapp)(\/|$)/, 'settings'],
  [/^\/api\/admin\/settings(\/|$)/, 'settings'],
  [/^\/api\/admin\/(categories|categories-structure|home-layout|homepage-layout|media|social-links|section-counts|site-config|translations)(\/|$)/, 'content'],
  [/^\/api\/(blog|commodity-prices|currency-rates|farmer-marketplace)(\/|$)/, 'content'],
  [/^\/api\/admin\/(users|kyc|cv-history)(\/|$)/, 'users'],
  [/^\/api\/admin\/(packages|subscriptions|transactions)(\/|$)/, 'payments'],
  [/^\/api\/payments\/admin(\/|$)/, 'payments'],
  [/^\/api\/admin\/stores(\/|$)/, 'stores'],
  [/^\/api\/store-rentals\/admin(\/|$)/, 'stores'],
  [/^\/api\/(support\/admin|cv-service-requests)(\/|$)/, 'support'],
];

/** What a request needs. Unmapped admin endpoints need the primary admin. */
export function requiredAdminAccess(fullPath: string): RequiredAccess {
  const path = fullPath.split('?')[0].replace(/\/+$/, '') || '/';
  for (const [re, need] of RULES) if (re.test(path)) return need;
  return 'primary';
}

export interface AdminIdentity {
  role: string;
  isPrimaryAdmin?: boolean;
  adminPermissions?: string[];
}

/** Can this admin identity use an endpoint needing `need`? Non-admins never pass. */
export function adminMayAccess(user: AdminIdentity, need: RequiredAccess): boolean {
  if (user.role !== 'ADMIN') return false;
  if (user.isPrimaryAdmin) return true;
  if (need === 'any') return true;
  if (need === 'primary') return false;
  return (user.adminPermissions ?? []).includes(need);
}

// Some user-facing routers contain inline "admin may override ownership" checks (role === 'ADMIN') instead of
// authorize('ADMIN'). A secondary admin without the matching permission must not get those powers, so for these
// prefixes authenticate() treats them as an ordinary user for the request (see middleware/auth.ts).
const OVERRIDE_RULES: Array<[RegExp, AdminPermission]> = [
  [/^\/api\/(listings|upload|jobs)(\/|$)/, 'listings'],
  [/^\/api\/farmer-marketplace(\/|$)/, 'content'],
  [/^\/api\/payments\/[^/]+\/receipt(\.pdf|\/|$)/, 'payments'],
];

/** The permission needed to use admin overrides on a user-facing path, or null when the path has none. */
export function adminOverrideAccess(fullPath: string): AdminPermission | null {
  const path = fullPath.split('?')[0];
  for (const [re, need] of OVERRIDE_RULES) if (re.test(path)) return need;
  return null;
}

/** Should this admin keep admin powers on this user-facing path? Primary: always. */
export function keepsAdminPowers(user: AdminIdentity, fullPath: string): boolean {
  const need = adminOverrideAccess(fullPath);
  return need === null || adminMayAccess(user, need);
}
