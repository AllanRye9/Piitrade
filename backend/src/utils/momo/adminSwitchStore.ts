/**
 * momo/adminSwitchStore.ts — loads, saves and keeps in sync the admin's MoMo on/off switch.
 *
 * Storage: SiteConfig.momoEnabled (null = never set). The in-memory copy (adminSwitch.ts) is refreshed
 * at start-up and then every 15 s, so on a multi-instance deployment a change made on one instance
 * reaches the others within that time. The instance that handles the admin's click updates at once.
 *
 * Fail-safe: if the database cannot be read, the last known value is kept (never flipped to "on").
 */
import { prisma } from '../prisma';
import { logger } from '../logger';
import { getMomoAdminSwitch, setMomoAdminSwitch } from './adminSwitch';

const SYNC_INTERVAL_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;

/** Reads the stored switch into memory and returns it. */
export async function loadMomoAdminSwitch(): Promise<boolean | null> {
  const row = await prisma.siteConfig.findUnique({ where: { id: 'global' }, select: { momoEnabled: true } });
  const value = row?.momoEnabled ?? null;
  setMomoAdminSwitch(value);
  return value;
}

/** Stores the admin's choice and applies it on this instance immediately. */
export async function saveMomoAdminSwitch(enabled: boolean): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { id: 'global' },
    update: { momoEnabled: enabled },
    create: { id: 'global', momoEnabled: enabled },
  });
  setMomoAdminSwitch(enabled);
}

/** Loads once now, then keeps the in-memory copy fresh. Safe to call more than once. Resolves after the first load attempt. */
export async function startMomoAdminSwitchSync(): Promise<void> {
  const refresh = async () => {
    try {
      const before = getMomoAdminSwitch();
      const after = await loadMomoAdminSwitch();
      if (before !== after) logger.info(`MTN MoMo: admin switch is now ${after === null ? 'unset (MTN_ENABLED decides)' : after ? 'ON' : 'OFF'}`);
    } catch (err) {
      logger.warn(`MTN MoMo: could not read the admin switch, keeping the last known value: ${String(err)}`);
    }
  };
  await refresh();
  if (!timer) {
    timer = setInterval(refresh, SYNC_INTERVAL_MS);
    timer.unref?.();
  }
}
