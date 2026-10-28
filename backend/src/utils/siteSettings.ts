// Admin-managed general settings (SiteConfig.generalSettings, edited at
// /admin/settings). One cached reader so every enforcement point (maintenance
// mode, registration switch, page size, image cap, trial length) reads the
// same values without a DB hit per request.

import { prisma } from './prisma';

export interface GeneralSettings {
  siteName: string;
  maintenanceMode: boolean;
  allowRegistration: boolean;
  itemsPerPage: number;
  maxImagesPerListing: number;
  trialDays: number;
  specialFindsEnabled: boolean;
  /** Top-level category slugs in the order buyers should see them (may be partial; admin-set). */
  categoryRank: string[];
  /** Top-level category slugs hidden from buyer surfaces (nav, home, search, filters; admin-set). */
  hiddenCategories: string[];
}

export const GENERAL_DEFAULTS: GeneralSettings = {
  siteName: 'Piitrade',
  maintenanceMode: false,
  allowRegistration: true,
  itemsPerPage: 20,
  maxImagesPerListing: 10,
  trialDays: 7,
  // Master switch for the mobile Special Offers popup (legacy name kept).
  specialFindsEnabled: true,
  categoryRank: [],
  hiddenCategories: [],
};

const TTL_MS = 15_000;
let cache: { value: GeneralSettings; expires: number } | null = null;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_CATEGORY_SLUGS = 60;

/** A de-duplicated list of kebab-case category slugs (invalid entries dropped, capped). */
export function normalizeSlugList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const slug = item.trim().toLowerCase();
    if (slug.length <= 80 && SLUG_RE.test(slug) && !out.includes(slug)) out.push(slug);
    if (out.length >= MAX_CATEGORY_SLUGS) break;
  }
  return out;
}

export function normalizeGeneralSettings(stored: Record<string, unknown> | null | undefined): GeneralSettings {
  const s = stored || {};
  return {
    siteName: typeof s.siteName === 'string' && s.siteName.trim() ? s.siteName.trim().slice(0, 60) : GENERAL_DEFAULTS.siteName,
    maintenanceMode: s.maintenanceMode === true,
    allowRegistration: s.allowRegistration !== false,
    itemsPerPage: clampInt(s.itemsPerPage, 4, 100, GENERAL_DEFAULTS.itemsPerPage),
    maxImagesPerListing: clampInt(s.maxImagesPerListing, 1, 30, GENERAL_DEFAULTS.maxImagesPerListing),
    trialDays: clampInt(s.trialDays, 0, 365, GENERAL_DEFAULTS.trialDays),
    specialFindsEnabled: s.specialFindsEnabled !== false,
    categoryRank: normalizeSlugList(s.categoryRank),
    hiddenCategories: normalizeSlugList(s.hiddenCategories),
  };
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  if (cache && Date.now() < cache.expires) return cache.value;
  try {
    const config = await prisma.siteConfig.findUnique({ where: { id: 'global' }, select: { generalSettings: true } });
    const value = normalizeGeneralSettings(config?.generalSettings as Record<string, unknown> | null);
    cache = { value, expires: Date.now() + TTL_MS };
    return value;
  } catch {
    // Never take the site down because settings couldn't be read.
    return cache?.value ?? GENERAL_DEFAULTS;
  }
}

export function invalidateGeneralSettings(): void {
  cache = null;
}
