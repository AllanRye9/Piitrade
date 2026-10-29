/**
 * momo/adminSwitch.ts — the admin's on/off switch for MTN MoMo, held in memory.
 *
 * The value lives in the database (SiteConfig.momoEnabled, see adminSwitchStore.ts) and is mirrored here
 * so the many synchronous "is MoMo on?" checks (config.ts) stay synchronous and need no database.
 * This file deliberately imports nothing, so config.ts and its unit tests stay free of Prisma.
 *
 *   null  = the admin never chose: the MTN_ENABLED environment variable decides (the original behaviour)
 *   true  = the admin switched MoMo ON  (wins over MTN_ENABLED)
 *   false = the admin switched MoMo OFF (wins over MTN_ENABLED)
 *
 * The switch only controls whether NEW payments are accepted. Credentials stay in environment variables.
 */
let adminSwitch: boolean | null = null;

export function getMomoAdminSwitch(): boolean | null {
  return adminSwitch;
}

export function setMomoAdminSwitch(value: boolean | null): void {
  adminSwitch = value;
}
