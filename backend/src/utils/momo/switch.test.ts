import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
const audit = vi.hoisted(() => ({ recordAdminAudit: vi.fn() }));
vi.mock('../prisma', () => ({ prisma: { siteConfig: { findUnique: db.findUnique, upsert: db.upsert } } }));
vi.mock('../adminAudit', () => audit);

import { applyMomoSwitch, readStoredMomoSwitch, refreshMomoSwitch, saveMomoSwitch } from './switch';
import { getMomoAdminSwitch, setMomoAdminSwitch } from './config';

const GOOD_ENV = {
  MTN_ENVIRONMENT: 'sandbox',
  MTN_TARGET_ENVIRONMENT: 'sandbox',
  MTN_BASE_URL: 'https://sandbox.momodeveloper.mtn.com',
  MTN_SUBSCRIPTION_KEY: 'a3f1c2d4e5b6a7980123456789abcdef',
  MTN_API_USER: '7b9a4c12-3456-4789-a12b-3456789abcde',
  MTN_API_KEY: 'b09f1234567890abcdef1234567890ab',
  API_BASE_URL: 'https://api.piitrade.test',
  MTN_CALLBACK_SECRET: 'c'.repeat(40),
};
const SAVED_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  setMomoAdminSwitch(null);
  audit.recordAdminAudit.mockResolvedValue(undefined);
  db.upsert.mockResolvedValue({});
});
afterEach(() => {
  setMomoAdminSwitch(null);
  process.env = { ...SAVED_ENV };
});

function useEnv(env: Record<string, string | undefined>) {
  for (const k of Object.keys(process.env)) if (k.startsWith('MTN_')) delete process.env[k];
  Object.assign(process.env, Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)));
}

describe('readStoredMomoSwitch / refreshMomoSwitch', () => {
  it('reads true, false, and null when never set', async () => {
    db.findUnique.mockResolvedValueOnce({ generalSettings: { momoEnabled: true } });
    expect(await readStoredMomoSwitch()).toBe(true);
    db.findUnique.mockResolvedValueOnce({ generalSettings: { momoEnabled: false } });
    expect(await readStoredMomoSwitch()).toBe(false);
    db.findUnique.mockResolvedValueOnce({ generalSettings: { siteName: 'X' } });
    expect(await readStoredMomoSwitch()).toBeNull();
    db.findUnique.mockResolvedValueOnce(null);
    expect(await readStoredMomoSwitch()).toBeNull();
  });

  it('refresh copies the stored switch into memory', async () => {
    db.findUnique.mockResolvedValueOnce({ generalSettings: { momoEnabled: false } });
    await refreshMomoSwitch();
    expect(getMomoAdminSwitch()).toBe(false);
  });

  it('a failed read keeps the last known value and never throws', async () => {
    setMomoAdminSwitch(true);
    db.findUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(refreshMomoSwitch()).resolves.toBeUndefined();
    expect(getMomoAdminSwitch()).toBe(true);
  });
});

describe('saveMomoSwitch', () => {
  it('writes the switch, preserves every other general setting, and applies it in memory at once', async () => {
    db.findUnique.mockResolvedValueOnce({ generalSettings: { siteName: 'Acme', itemsPerPage: 40, maintenanceMode: true } });
    await saveMomoSwitch(true);
    const written = db.upsert.mock.calls[0][0].update.generalSettings;
    expect(written).toMatchObject({ siteName: 'Acme', itemsPerPage: 40, maintenanceMode: true, momoEnabled: true });
    expect(db.upsert.mock.calls[0][0].create.generalSettings.momoEnabled).toBe(true);
    expect(getMomoAdminSwitch()).toBe(true);
  });

  it('works when no site config row exists yet', async () => {
    db.findUnique.mockResolvedValueOnce(null);
    await saveMomoSwitch(false);
    expect(db.upsert.mock.calls[0][0].create.generalSettings.momoEnabled).toBe(false);
    expect(getMomoAdminSwitch()).toBe(false);
  });
});

describe('applyMomoSwitch', () => {
  beforeEach(() => { db.findUnique.mockResolvedValue({ generalSettings: {} }); });

  it('turns MoMo ON with no MTN_ENABLED variable when the credentials are complete, and audits it', async () => {
    useEnv(GOOD_ENV);
    const r = await applyMomoSwitch(true, 'admin-1');
    expect(r.ok).toBe(true);
    expect(r.status).toMatchObject({ enabled: true, switchedOn: true, switchSource: 'admin' });
    expect(audit.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'MOMO_SWITCHED_ON', actorId: 'admin-1' }));
  });

  it('refuses to turn ON while credentials are incomplete: nothing is saved, nothing audited, problems are named', async () => {
    useEnv({ ...GOOD_ENV, MTN_API_KEY: undefined });
    const r = await applyMomoSwitch(true, 'admin-1');
    expect(r.ok).toBe(false);
    expect(r.status.problems).toEqual(['MTN_API_KEY is not set']);
    expect(db.upsert).not.toHaveBeenCalled();
    expect(audit.recordAdminAudit).not.toHaveBeenCalled();
    expect(getMomoAdminSwitch()).toBeNull();
  });

  it('turning OFF is always allowed, even with a broken configuration, and overrides MTN_ENABLED=true', async () => {
    useEnv({ ...GOOD_ENV, MTN_ENABLED: 'true', MTN_API_KEY: undefined });
    const r = await applyMomoSwitch(false, 'admin-1');
    expect(r.ok).toBe(true);
    expect(r.status).toMatchObject({ enabled: false, switchedOn: false, switchSource: 'admin' });
    expect(audit.recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'MOMO_SWITCHED_OFF' }));
  });

  it('still succeeds when only the audit row fails to write', async () => {
    useEnv(GOOD_ENV);
    audit.recordAdminAudit.mockRejectedValueOnce(new Error('audit table locked'));
    const r = await applyMomoSwitch(true, 'admin-1');
    expect(r.ok).toBe(true);
    expect(getMomoAdminSwitch()).toBe(true);
  });
});
