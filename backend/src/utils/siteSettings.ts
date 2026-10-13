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
};

const TTL_MS = 15_000;
let cache: { value: GeneralSettings; expires: number } | null = null;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
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
