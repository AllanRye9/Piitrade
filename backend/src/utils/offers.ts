// Shared resolution of the admin-controlled "Special Offers" and "Back to
// School" section configs (SiteConfig.specialOffers / SiteConfig.backToSchool).
// Used by the public listing endpoints so the section-level switch, the
// discount threshold and the scheduled window are applied identically
// everywhere (home sections, dedicated pages, mobile popup).

interface SiteConfigLike {
  specialOffers?: unknown;
  backToSchool?: unknown;
  generalSettings?: unknown;
}

export interface ResolvedSpecialOffers {
  enabled: boolean;
  active: boolean;
  minDiscountPercent: number;
  startAt: string | null;
  endAt: string | null;
}

export interface ResolvedBackToSchool {
  enabled: boolean;
  active: boolean;
  startAt: string | null;
  endAt: string | null;
}

function inWindow(startAt: string | null | undefined, endAt: string | null | undefined, now: Date): boolean {
  return (!startAt || new Date(startAt).getTime() <= now.getTime())
    && (!endAt || new Date(endAt).getTime() >= now.getTime());
}

export function resolveSpecialOffers(config: SiteConfigLike | null | undefined, now = new Date()): ResolvedSpecialOffers {
  const stored = (config?.specialOffers as { enabled?: boolean; minDiscountPercent?: number; startAt?: string | null; endAt?: string | null } | null) || {};
  const general = (config?.generalSettings as { specialFindsEnabled?: boolean } | null) || {};
  const enabled = stored.enabled !== undefined ? !!stored.enabled : general.specialFindsEnabled !== false;
  const minDiscountPercent = typeof stored.minDiscountPercent === 'number'
    ? Math.min(99, Math.max(1, stored.minDiscountPercent))
    : 30;
  return {
    enabled,
    active: enabled && inWindow(stored.startAt, stored.endAt, now),
    minDiscountPercent,
    startAt: stored.startAt || null,
    endAt: stored.endAt || null,
  };
}

export function resolveBackToSchool(config: SiteConfigLike | null | undefined, now = new Date()): ResolvedBackToSchool {
  const stored = (config?.backToSchool as { enabled?: boolean; startAt?: string | null; endAt?: string | null } | null) || {};
  const enabled = !!stored.enabled;
  return {
    enabled,
    active: enabled && inWindow(stored.startAt, stored.endAt, now),
    startAt: stored.startAt || null,
    endAt: stored.endAt || null,
  };
}

/**
 * Validates a seller-supplied "was" price against the selling price.
 * Returns the number to store, null to clear, or an error string.
 */
export function parseOriginalPrice(raw: unknown, price: number): { value: number | null } | { error: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n < 0) return { error: 'originalPrice must be a valid non-negative number' };
  if (n <= price) return { error: 'originalPrice must be greater than the selling price' };
  return { value: n };
}

export function discountPercent(price: number, originalPrice: number | null | undefined): number {
  if (!originalPrice || originalPrice <= price || originalPrice <= 0) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}
