/**
 * momo/switch.ts — the admin's MTN MoMo ON/OFF switch, persisted in SiteConfig.generalSettings.momoEnabled
 * (no schema migration) and mirrored into utils/momo/config.ts, whose synchronous callers read it from memory.
 *
 *   • loaded at startup and re-synced every 30 s so several server instances agree;
 *   • updated immediately on the instance that handles an admin change (PUT /api/payments/admin/switch).
 *
 * A failed read keeps the last known value, so a brief database hiccup never flips the switch.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { normalizeGeneralSettings, invalidateGeneralSettings } from '../siteSettings';
import { recordAdminAudit } from '../adminAudit';
import { getMomoStatus, setMomoAdminSwitch, type MomoStatus } from './config';

const SITE_CONFIG_ID = 'global';
const SYNC_INTERVAL_MS = 30_000;

/** The stored switch, or null when an admin has never set it. */
export async function readStoredMomoSwitch(): Promise<boolean | null> {
  const config = await prisma.siteConfig.findUnique({ where: { id: SITE_CONFIG_ID }, select: { generalSettings: true } });
  const value = (config?.generalSettings as Record<string, unknown> | null | undefined)?.momoEnabled;
  return typeof value === 'boolean' ? value : null;
}

/** Copies the stored switch into memory. Never throws. */
export async function refreshMomoSwitch(): Promise<void> {
  try {
    setMomoAdminSwitch(await readStoredMomoSwitch());
  } catch (err) {
    logger.warn(`MTN MoMo: could not read the admin switch; keeping the last known value (${err instanceof Error ? err.message : 'unknown error'})`);
  }
}

/** Persists the switch (other general settings are preserved) and applies it on this instance at once. */
export async function saveMomoSwitch(enabled: boolean): Promise<void> {
  const config = await prisma.siteConfig.findUnique({ where: { id: SITE_CONFIG_ID }, select: { generalSettings: true } });
  const current = (config?.generalSettings as Record<string, unknown> | null | undefined) ?? {};
  const generalSettings = normalizeGeneralSettings({ ...current, momoEnabled: enabled }) as unknown as Prisma.InputJsonValue;
  await prisma.siteConfig.upsert({
    where: { id: SITE_CONFIG_ID },
    create: { id: SITE_CONFIG_ID, generalSettings },
    update: { generalSettings },
  });
  invalidateGeneralSettings();
  setMomoAdminSwitch(enabled);
}

/** Keeps the in-memory switch in sync. Call once at startup, after awaiting refreshMomoSwitch(). */
export function startMomoSwitchSync(intervalMs: number = SYNC_INTERVAL_MS): NodeJS.Timeout {
  const timer = setInterval(() => { void refreshMomoSwitch(); }, intervalMs);
  timer.unref?.();
  return timer;
}

/** `message` is set only when the change was refused. (Not a discriminated union: this project is not in strict mode, so narrowing would not work.) */
export interface MomoSwitchResult {
  ok: boolean;
  message?: string;
  status: MomoStatus;
}

/**
 * The admin flips the switch. ON is refused while the MTN credentials are incomplete (an admin can never
 * "enable" something that cannot work); OFF is always allowed. Pending payments keep reconciling either
 * way — the reconciler simply pauses while MoMo is off. Every change is audited.
 */
export async function applyMomoSwitch(enabled: boolean, actorId: string): Promise<MomoSwitchResult> {
  const before = getMomoStatus();
  if (enabled && before.problems.length > 0) {
    return { ok: false, message: 'MTN MoMo cannot be switched on until its configuration is complete.', status: before };
  }
  await saveMomoSwitch(enabled);
  await recordAdminAudit({
    action: enabled ? 'MOMO_SWITCHED_ON' : 'MOMO_SWITCHED_OFF',
    actorId,
    meta: { wasOn: before.switchedOn, switchSource: before.switchSource },
  }).catch((err) => {
    // The change itself succeeded; do not fail the request over the audit row.
    logger.warn(`MTN MoMo: switch changed but the audit row could not be written (${err instanceof Error ? err.message : 'unknown error'})`);
  });
  return { ok: true, status: getMomoStatus() };
}
