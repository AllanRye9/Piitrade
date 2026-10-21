/**
 * Live end-to-end check of your MTN MoMo SANDBOX setup, using the exact client the server uses.
 *
 *   npm run momo:sandbox:check            # reads backend/.env (or the process environment)
 *   npm run momo:sandbox:check -- 46733123451   # use another sandbox test number
 *
 * Steps: validate .env -> access token -> account-holder check -> requesttopay (1 EUR) -> poll the
 * status until MTN answers. Sandbox test numbers: 46733123450 = SUCCESSFUL, 46733123451 = FAILED,
 * 46733123452 = REJECTED, 46733123453 = TIMEOUT, 46733123454 = stays PENDING.
 * Sandbox only; moves no real money. Never prints the API key, subscription key or token.
 */
import crypto from 'crypto';
import path from 'path';
import { config as loadEnv } from 'dotenv';

const projectRoot = path.resolve(__dirname, '..');
for (const envFile of ['.env.local', '.env', '../.env']) loadEnv({ path: path.resolve(projectRoot, envFile) });

import { describeMomoConfigProblems, loadMomoConfig } from '../src/utils/momo/config';
import { HttpMomoClient, MomoApiError } from '../src/utils/momo/client';

const ok = (m: string) => console.log(`  ✔ ${m}`);
function die(m: string): never { console.error(`  ✘ ${m}`); process.exit(1); }

async function main() {
  console.log('MTN MoMo sandbox check\n');
  process.env.MTN_ENABLED = 'true'; // we are checking the configuration, whatever the flag says
  if ((process.env.MTN_ENVIRONMENT ?? 'sandbox').toLowerCase() === 'production') die('MTN_ENVIRONMENT=production — this check only runs against the sandbox.');

  const problems = describeMomoConfigProblems();
  if (problems.length) {
    console.error('  Configuration problems:');
    for (const p of problems) console.error(`   - ${p}`);
    console.error('\n  Tip: MTN_API_USER / MTN_API_KEY must be generated for YOUR subscription key: `npm run momo:sandbox:provision`.');
    process.exit(1);
  }
  const cfg = loadMomoConfig();
  ok(`configuration is consistent (${cfg.environment}, target=${cfg.targetEnvironment}, currency=${cfg.currency}, callbacks=${cfg.callbackUrl ? cfg.callbackUrl : 'off'})`);
  if (cfg.currency !== 'EUR') console.log('  ! The sandbox only accepts EUR; set MTN_CURRENCY=EUR.');

  const client = new HttpMomoClient(cfg);
  try { await client.getToken(); ok('access token obtained (API user + API key + subscription key are valid)'); }
  catch (e) { die(`token request failed: ${(e as Error).message}. The API user/key do not belong to this subscription key — run \`npm run momo:sandbox:provision\` and use what it prints.`); }

  const number = process.argv[2] ?? '46733123450';
  try { ok(`account-holder check for ${number}: ${(await client.validateAccountHolder(number)) ? 'active' : 'not active'}`); }
  catch (e) { console.log(`  ! account check unavailable (${(e as Error).message}) — the server continues without it`); }

  const referenceId = crypto.randomUUID();
  try {
    await client.requestToPay({
      referenceId, amount: '1', currency: cfg.currency, externalId: `check-${Date.now()}`, msisdn: number,
      payerMessage: 'Piitrade sandbox check', payeeNote: 'Piitrade sandbox check', callbackUrl: null,
    });
    ok(`requesttopay accepted (202) — reference ${referenceId}`);
  } catch (e) {
    die(`requesttopay failed: ${(e as Error).message}${e instanceof MomoApiError && e.code ? '' : ''}`);
  }

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await client.getRequestToPayStatus(referenceId);
    console.log(`  … status ${st.rawStatus}${st.reason ? ` (${st.reason})` : ''}`);
    if (st.outcome !== 'PENDING') {
      ok(`final status ${st.rawStatus}; amount=${st.amount} ${st.currency}; financialTransactionId=${st.financialTransactionId ?? '—'}`);
      console.log('\nAll good: your sandbox credentials and the client work end to end.');
      return;
    }
  }
  console.log('\nStill PENDING after 36 s — expected only for the 46733123454 test number. The credentials and request flow work.');
}

main().catch((e) => die(`unexpected error: ${(e as Error).message}`));
