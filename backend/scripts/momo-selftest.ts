/**
 * Offline self-test of the whole MTN MoMo collection flow. No internet, no MTN credentials, no database.
 *
 *   npm run momo:selftest
 *
 * Starts an in-process imitation of the MTN sandbox (src/utils/momo/fakeMtn.ts) and drives the real
 * HttpMomoClient through every sandbox outcome: success, the three failures, a payer that never
 * answers, an idempotent retry, an expired token and a 503. Exit code 0 = all passed.
 *
 * To test against the REAL MTN sandbox instead (needs your keys): `npm run momo:sandbox:check`.
 * The two checks answer different questions: this one proves OUR code is right; that one proves
 * YOUR MTN credentials are right.
 */
import crypto from 'crypto';
import { HttpMomoClient, MomoApiError } from '../src/utils/momo/client';
import { loadMomoConfig } from '../src/utils/momo/config';
import { FakeMtn } from '../src/utils/momo/fakeMtn';

const KEYS = { subscriptionKey: 'selftest-subscription-key-0123456789', apiUser: '7b9a4c12-3456-4789-a12b-3456789abcde', apiKey: 'selftest-api-key-0123456789abcdef' };
let failed = 0;
const check = (name: string, pass: boolean, detail = '') => { console.log(`  ${pass ? '✔' : '✘'} ${name}${detail ? `  (${detail})` : ''}`); if (!pass) failed += 1; };

async function pollUntilDone(c: HttpMomoClient, ref: string) {
  for (let i = 0; i < 6; i++) { const s = await c.getRequestToPayStatus(ref); if (s.outcome !== 'PENDING') return s; }
  return c.getRequestToPayStatus(ref);
}

async function main() {
  console.log('MoMo offline self-test (fake MTN sandbox)\n');
  const fake = await new FakeMtn({ ...KEYS, pendingPolls: 1 }).start();
  fake.expectedCurrency = 'EUR';
  const cfg = loadMomoConfig({
    MTN_ENABLED: 'true', MTN_ENVIRONMENT: 'sandbox', MTN_TARGET_ENVIRONMENT: 'sandbox', MTN_BASE_URL: fake.baseUrl,
    MTN_SUBSCRIPTION_KEY: KEYS.subscriptionKey, MTN_API_USER: KEYS.apiUser, MTN_API_KEY: KEYS.apiKey,
  });
  const c = new HttpMomoClient(cfg);
  const start = async (msisdn: string, extra: { callbackUrl?: string } = {}) => {
    const referenceId = crypto.randomUUID();
    await c.requestToPay({ referenceId, amount: '50', currency: 'EUR', externalId: `txn-${referenceId.slice(0, 8)}`, msisdn, payerMessage: 'Piitrade', payeeNote: 'Piitrade', ...extra });
    return referenceId;
  };

  try {
    check('token obtained with API user + key + subscription key', (await c.getToken()).startsWith('fake-'));

    const ok = await pollUntilDone(c, await start('46733123450'));
    check('46733123450 -> SUCCESSFUL with a financial transaction id', ok.outcome === 'SUCCESSFUL' && !!ok.financialTransactionId, ok.financialTransactionId ?? '');

    for (const [n, why] of [['46733123451', 'PAYER_NOT_FOUND'], ['46733123452', 'APPROVAL_REJECTED'], ['46733123453', 'EXPIRED']] as const) {
      const s = await pollUntilDone(c, await start(n));
      check(`${n} -> FAILED (${why})`, s.outcome === 'FAILED' && s.reason === why);
    }

    const pendingRef = await start('46733123454');
    let stillPending = true;
    for (let i = 0; i < 4; i++) if ((await c.getRequestToPayStatus(pendingRef)).outcome !== 'PENDING') stillPending = false;
    check('46733123454 -> stays PENDING (never treated as paid)', stillPending);

    const ref = await start('46733123450');
    let dup = true;
    try { await c.requestToPay({ referenceId: ref, amount: '50', currency: 'EUR', externalId: 'x', msisdn: '46733123450', payerMessage: 'a', payeeNote: 'b' }); } catch { dup = false; }
    check('retrying the same reference id is idempotent (409 accepted)', dup);

    const cbRef = await start('46733123450', { callbackUrl: 'https://api.example.com/api/payments/momo/callback/x?s=sig' });
    check('callback URL is passed to MTN', fake.payments.get(cbRef)?.callbackUrl?.includes('/callback/x') === true);

    const issued = fake.tokensIssued; fake.reject401 = 1;
    await start('46733123450');
    check('expired token is refreshed once and the payment still succeeds', fake.tokensIssued === issued + 1);

    fake.fail503 = 1;
    const e = await start('46733123450').catch((x) => x);
    check('503 from MTN is flagged retryable', e instanceof MomoApiError && e.retryable);

    const bad = await new HttpMomoClient({ ...cfg, apiKey: 'nope-nope-nope-nope-nope' }).getToken().catch((x) => x as Error);
    check('wrong credentials are rejected and never echoed', bad instanceof MomoApiError && !bad.message.includes('nope-nope'));

    const ugx = await start('46733123450').then(() => null, (x) => x);
    check('(sanity) normal payment still works afterwards', ugx === null);
  } finally {
    await fake.stop();
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
