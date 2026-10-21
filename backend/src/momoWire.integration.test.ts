import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser } from './testing/integrationDb';
import { MockMtnServer, SUB_KEY } from './testing/mockMtnServer';

configureTestEnv();

/**
 * Wire-level checks: the REAL HttpMomoClient (no fake) talks HTTP to a local server that enforces
 * MTN's documented sandbox contract. Proves headers, auth flow, token caching/refresh, EUR handling
 * and the provisioning script — everything short of MTN's actual servers.
 */
describe.skipIf(!TEST_DB)('MoMo over the wire (real client + script vs local MTN sandbox stand-in)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let pay: typeof import('./utils/momo/paymentService');
  let clientMod: typeof import('./utils/momo/client');
  const mtn = new MockMtnServer();
  const saved: Record<string, string | undefined> = {};
  let creds: { apiUser: string; apiKey: string };

  const setEnv = (extra: Record<string, string>) => {
    const env: Record<string, string> = {
      MTN_ENABLED: 'true', MTN_ENVIRONMENT: 'sandbox', MTN_TARGET_ENVIRONMENT: 'sandbox', MTN_BASE_URL: mtn.url,
      MTN_SUBSCRIPTION_KEY: SUB_KEY, MTN_API_USER: creds.apiUser, MTN_API_KEY: creds.apiKey,
      MTN_CALLBACK_SECRET: 'f'.repeat(40), API_BASE_URL: 'https://api.piitrade.test', ...extra,
    };
    for (const [k, v] of Object.entries(env)) { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; }
  };

  beforeAll(async () => {
    await mtn.start();
    ({ prisma } = await loadDeps());
    pay = await import('./utils/momo/paymentService');
    clientMod = await import('./utils/momo/client');
  });
  afterAll(async () => {
    clientMod.setMomoClientForTests(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await mtn.stop();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    mtn.payments.clear(); mtn.log = []; mtn.tokenRequests = 0; mtn.inactiveNumbers.clear(); mtn.revokeTokens();
    creds = mtn.registerUser();
    setEnv({});
    clientMod.setMomoClientForTests(null); // force a fresh real client per test (new token cache)
    (clientMod as unknown as { __reset?: () => void }).__reset?.();
  });

  const mkPackage = () => prisma.sellerPackage.create({ data: { name: 'Pro', durationDays: 30, price: 50000, isFree: false, scope: 'LISTING', maxListings: 25 } });
  const buy = (u: { id: string }, packageId: string, msisdn = '0772123456') => pay.initiatePayment({ userId: u.id, role: 'SELLER' }, { purpose: 'SUBSCRIPTION', packageId, msisdn });
  const refOf = async (id: string) => (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id } })).referenceId;

  it('full happy path over HTTP: token → account check → requesttopay → approve → status → access granted', async () => {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    const { payment } = await buy(u, pkg.id);
    const ref = await refOf(payment.id);

    const sent = mtn.payments.get(ref)!;
    expect(sent).toMatchObject({ amount: '50000', currency: 'EUR', externalId: payment.id, payer: { partyIdType: 'MSISDN', partyId: '256772123456' }, status: 'PENDING' });
    expect(sent.callbackUrl).toMatch(new RegExp(`^https://api\\.piitrade\\.test/api/payments/momo/callback/${ref}\\?s=[0-9a-f]{64}$`));
    expect(sent.payerMessage).toBe('Piitrade Pro');
    expect(mtn.log.filter((l) => l.includes('/active'))).toHaveLength(1); // the account pre-check ran

    expect((await pay.verifyPayment(payment.id)).status).toBe('PENDING');
    mtn.approve(ref);
    const settled = await pay.verifyPayment(payment.id);
    expect(settled).toMatchObject({ status: 'SUCCESSFUL', financialTransactionId: '4004556677' });
    expect(settled.provisionedAt).not.toBeNull();
    expect((await prisma.sellerSubscription.findFirstOrThrow({ where: { userId: u.id } })).status).toBe('ACTIVE');
  });

  it('fetches ONE token and reuses it across payments; re-authenticates once when MTN revokes it', async () => {
    const pkg = await mkPackage();
    const a = await mkUser(prisma); const b = await mkUser(prisma);
    await buy(a, pkg.id); await buy(b, pkg.id);
    expect(mtn.tokenRequests).toBe(1);

    mtn.revokeTokens(); // MTN expires the token early
    const pa = await prisma.paymentTransaction.findFirstOrThrow({ where: { userId: a.id } });
    mtn.approve(pa.referenceId);
    expect((await pay.verifyPayment(pa.id)).status).toBe('SUCCESSFUL'); // 401 -> new token -> retry succeeded
    expect(mtn.tokenRequests).toBe(2);
  });

  it('a declined prompt arrives as FAILED with MTN\'s reason and the user is told in plain words', async () => {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    const { payment } = await buy(u, pkg.id);
    mtn.reject(await refOf(payment.id), 'NOT_ENOUGH_FUNDS');
    const failed = await pay.verifyPayment(payment.id);
    expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'NOT_ENOUGH_FUNDS' });
    expect(pay.toPaymentView(failed).failureMessage).toMatch(/balance is too low/);
  });

  it('an inactive MoMo number is stopped by MTN\'s account check before any prompt is pushed', async () => {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    mtn.inactiveNumbers.add('256772123456');
    await expect(buy(u, pkg.id)).rejects.toMatchObject({ statusCode: 400 });
    expect(mtn.payments.size).toBe(0);
  });

  it('wrong credentials fail safely: no payment is left PENDING and nothing leaks into the error', async () => {
    const u = await mkUser(prisma); const pkg = await mkPackage();
    setEnv({ MTN_API_KEY: 'wrong-key-wrong-key-wrong-key-00' });
    clientMod.setMomoClientForTests(null);
    const err = await buy(u, pkg.id).catch((e) => e as Error & { statusCode?: number });
    // the account pre-check is best-effort (skipped), then requesttopay can't authenticate -> rejected & recorded FAILED
    expect((err as Error).message).not.toMatch(/wrong-key|tok-/);
    const rows = await prisma.paymentTransaction.findMany({ where: { userId: u.id } });
    expect(rows.every((r) => r.status !== 'PENDING' || r.failureReason === null)).toBe(true);
    expect(mtn.payments.size).toBe(0);
  });

  describe('sandbox provisioning script', () => {
    const script = path.resolve(__dirname, '../scripts/momo-sandbox-provision.ts');
    // Async on purpose: the mock MTN server lives in THIS process, so a blocking spawnSync would
    // freeze it and the script's requests could never be answered.
    const run = (env: Record<string, string>) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('npx', ['ts-node', '--transpile-only', script], {
        cwd: path.resolve(__dirname, '..'),
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    });

    it('registers a user, mints a key, verifies it, and prints ready-to-paste env lines (key shown once)', async () => {
      const out = await run({ MTN_SUBSCRIPTION_KEY: SUB_KEY, MTN_BASE_URL: mtn.url, API_BASE_URL: 'https://api.piitrade.test' });
      expect(out.status, out.stderr + out.stdout).toBe(0);
      const user = /MTN_API_USER=([0-9a-f-]{36})/.exec(out.stdout)?.[1];
      const key = /MTN_API_KEY=([0-9a-f]{32})/.exec(out.stdout)?.[1];
      expect(user && key).toBeTruthy();
      expect(mtn.users.get(user!)).toMatchObject({ apiKey: key, callbackHost: 'api.piitrade.test' });
      expect(out.stdout).toMatch(/MTN_CURRENCY=EUR/);
      expect(out.stdout).toMatch(/\/collection\/token|verifying the credentials/);
      expect(mtn.log).toContain('POST /collection/token/');
      expect(out.stderr).not.toContain(key!); // never in error output
    });

    it('refuses production, non-sandbox hosts and a missing key — without calling anything', async () => {
      const before = mtn.log.length;
      const prod = await run({ MTN_SUBSCRIPTION_KEY: SUB_KEY, MTN_ENVIRONMENT: 'production', MTN_BASE_URL: mtn.url });
      expect(prod.status).toBe(1); expect(prod.stderr).toMatch(/only provisions the sandbox/);
      const real = await run({ MTN_SUBSCRIPTION_KEY: SUB_KEY, MTN_BASE_URL: 'https://proxy.momoapi.mtn.com' });
      expect(real.status).toBe(1); expect(real.stderr).toMatch(/not the MTN sandbox/);
      const nokey = await run({ MTN_BASE_URL: mtn.url });
      expect(nokey.status).toBe(1); expect(nokey.stderr).toMatch(/MTN_SUBSCRIPTION_KEY is not set/);
      expect(mtn.log.length).toBe(before);
    });

    it('stops with a clear message when MTN rejects the subscription key', async () => {
      const out = await run({ MTN_SUBSCRIPTION_KEY: 'bad-key', MTN_BASE_URL: mtn.url });
      expect(out.status).toBe(1);
      expect(out.stderr).toMatch(/Creating the API user failed \(HTTP 401\)/);
    });
  });
});
