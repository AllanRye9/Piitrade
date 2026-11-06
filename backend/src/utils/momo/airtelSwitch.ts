/**
 * momo/airtelSwitch.ts — the admin's Airtel Money ON/OFF switch, persisted in SiteConfig.generalSettings.airtelEnabled
 * (no schema migration) and mirrored into utils/momo/airtelConfig.ts. Same behaviour as the MTN switch
 * (utils/momo/switch.ts): loaded at startup, re-synced every 30 s, applied at once on the instance that handles a change.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { normalizeGeneralSettings, invalidateGeneralSettings } from '../siteSettings';
import { recordAdminAudit } from '../adminAudit';
import { getAirtelStatus, setAirtelAdminSwitch, type AirtelStatus } from './airtelConfig';

const SITE_CONFIG_ID = 'global';

export async function readStoredAirtelSwitch(): Promise<boolean | null> {
  const config = await prisma.siteConfig.findUnique({ where: { id: SITE_CONFIG_ID }, select: { generalSettings: true } });
  const value = (config?.generalSettings as Record<string, unknown> | null | undefined)?.airtelEnabled;
  return typeof value === 'boolean' ? value : null;
}

export async function refreshAirtelSwitch(): Promise<void> {
  try {
    setAirtelAdminSwitch(await readStoredAirtelSwitch());
  } catch (err) {
    logger.warn(`Airtel Money: could not read the admin switch; keeping the last known value (${err instanceof Error ? err.message : 'unknown error'})`);
  }
}

export async function saveAirtelSwitch(enabled: boolean): Promise<void> {
  const config = await prisma.siteConfig.findUnique({ where: { id: SITE_CONFIG_ID }, select: { generalSettings: true } });
  const current = (config?.generalSettings as Record<string, unknown> | null | undefined) ?? {};
  const generalSettings = normalizeGeneralSettings({ ...current, airtelEnabled: enabled }) as unknown as Prisma.InputJsonValue;
  await prisma.siteConfig.upsert({
    where: { id: SITE_CONFIG_ID },
    create: { id: SITE_CONFIG_ID, generalSettings },
    update: { generalSettings },
  });
  invalidateGeneralSettings();
  setAirtelAdminSwitch(enabled);
}

export function startAirtelSwitchSync(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(() => { void refreshAirtelSwitch(); }, intervalMs);
  timer.unref?.();
  return timer;
}

export interface AirtelSwitchResult { ok: boolean; message?: string; status: AirtelStatus }

/** ON is refused while the Airtel credentials are incomplete; OFF is always allowed. Every change is audited. */
export async function applyAirtelSwitch(enabled: boolean, actorId: string): Promise<AirtelSwitchResult> {
  const before = getAirtelStatus();
  if (enabled && before.problems.length > 0) {
    return { ok: false, message: 'Airtel Money cannot be switched on until its configuration is complete.', status: before };
  }
  await saveAirtelSwitch(enabled);
  await recordAdminAudit({
    action: enabled ? 'AIRTEL_SWITCHED_ON' : 'AIRTEL_SWITCHED_OFF',
    actorId,
    meta: { wasOn: before.switchedOn, switchSource: before.switchSource },
  }).catch((err) => {
    logger.warn(`Airtel Money: switch changed but the audit row could not be written (${err instanceof Error ? err.message : 'unknown error'})`);
  });
  return { ok: true, status: getAirtelStatus() };
}
