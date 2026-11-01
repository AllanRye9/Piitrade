export interface GeneralSettings {
  siteName: string;
  maintenanceMode: boolean;
  allowRegistration: boolean;
  itemsPerPage: number;
  maxImagesPerListing: number;
  trialDays: number;
  /**
   * Whether someone who has already had the free package may take it again (once their previous
   * term has ended — two plans can never overlap). Admin-chosen at /admin/settings. Defaults to
   * true so people who can't afford Gold/Platinum can keep listing for free.
   */
  allowFreeResubscribe: boolean;
  specialFindsEnabled: boolean;
  /** Top-level category slugs in the order buyers should see them (may be partial; admin-set). */
  categoryRank: string[];
  /** Top-level category slugs hidden from buyer surfaces (nav, home, search, filters; admin-set). */
  hiddenCategories: string[];
  /** Preserves the admin-managed MTN MoMo switch when other settings are saved. */
  momoEnabled?: boolean;
}

export const GENERAL_DEFAULTS: GeneralSettings = {
  siteName: 'Piitrade',
  maintenanceMode: false,
  allowRegistration: true,
  itemsPerPage: 20,
  maxImagesPerListing: 10,
  trialDays: 7,
  allowFreeResubscribe: true,
  specialFindsEnabled: true,
  categoryRank: [],
  hiddenCategories: [],
};

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
    allowFreeResubscribe: s.allowFreeResubscribe !== false,
    specialFindsEnabled: s.specialFindsEnabled !== false,
    categoryRank: normalizeSlugList(s.categoryRank),
    hiddenCategories: normalizeSlugList(s.hiddenCategories),
    ...(typeof s.momoEnabled === 'boolean' ? { momoEnabled: s.momoEnabled } : {}),
  };
}