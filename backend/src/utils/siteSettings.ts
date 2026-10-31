// Admin-managed general settings (SiteConfig.generalSettings, edited at
// /admin/settings). One cached reader so every enforcement point (maintenance
// mode, registration switch, page size, image cap, trial length) reads the
// same values without a DB hit per request.

import { prisma } from './prisma';
import { GENERAL_DEFAULTS, normalizeGeneralSettings, type GeneralSettings } from './siteSettingsRules';

export { GENERAL_DEFAULTS, normalizeGeneralSettings, normalizeSlugList } from './siteSettingsRules';
export type { GeneralSettings } from './siteSettingsRules';

const TTL_MS = 15_000;
let cache: { value: GeneralSettings; expires: number } | null = null;

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
