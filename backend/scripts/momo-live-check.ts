/**
 * Pre-flight check before switching MoMo from the sandbox to LIVE. It NEVER charges anyone.
 *
 *   MTN_ENVIRONMENT=production npm run momo:live:check     # reads backend/.env (or the process environment)
 *
 * Checks: configuration is complete and consistent for production (no sandbox values, https callback,
 * strong callback secret, UGX) -> the access token request works with your PRODUCTION API user/key ->
 * the collection account balance can be read -> the database has the receipt columns. Prints a
 * go / no-go verdict. Never prints the API key, subscription key or token.
 */
import path from 'path';
import { config as loadEnv } from 'dotenv';

const projectRoot = path.resolve(__dirname, '..');
for (const envFile of ['.env.local', '.env', '../.env']) loadEnv({ path: path.resolve(projectRoot, envFile) });

import { describeMomoConfigProblems, loadMomoConfig } from '../src/utils/momo/config';
import { HttpMomoClient } from '../src/utils/momo/client';

let blockers = 0;
const ok = (m: string) => console.log(`  \u2714 ${m}`);
const bad = (m: string) => { blockers++; console.error(`  \u2718 ${m}`); };
const warn = (m: string) => console.log(`  ! ${m}`);

async function main() {
  console.log('MTN MoMo LIVE readiness check (no money is moved)\n');
  process.env.MTN_ENABLED = 'true'; // we are checking the configuration, whatever the flag says

  if ((process.env.MTN_ENVIRONMENT ?? '').toLowerCase() !== 'production') {
    bad('MTN_ENVIRONMENT is not "production". Set MTN_ENVIRONMENT=production (and the production values) to run this check.');
    return;
  }
  const problems = describeMomoConfigProblems();
  if (problems.length) { problems.forEach((p) => bad(p)); return; }
  const cfg = loadMomoConfig();
  ok(`configuration is consistent (production, target=${cfg.targetEnvironment}, currency=${cfg.currency})`);
  if (!cfg.callbackUrl) warn('No callback URL: payments will be settled by polling only. Set API_BASE_URL (public https) so MTN can call back.');
  else ok(`callbacks go to ${cfg.callbackUrl.replace(/\/[^/]*$/, '/…')}`);
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) bad('No email provider (RESEND_API_KEY or SMTP_*): payers would not receive their receipts.');
  else ok('an email provider is configured for receipts');
  if (!process.env.FRONTEND_URL || /localhost|127\.0\.0\.1/.test(process.env.FRONTEND_URL)) warn('FRONTEND_URL is unset or local: receipt links and PDFs would point to the wrong address.');

  const client = new HttpMomoClient(cfg);
  try { await client.getToken(); ok('access token obtained (production API user, API key and subscription key match)'); }
  catch (e) { bad(`token request failed: ${(e as Error).message}`); return; }

  try {
    const r = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/collection/v1_0/account/balance`, {
      headers: {
        Authorization: `Bearer ${await client.getToken()}`, 'X-Target-Environment': cfg.targetEnvironment, 'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
      },
    });
    if (r.ok) ok('collection account balance readable (the account is active)');
    else warn(`balance request answered HTTP ${r.status} (not fatal; ask MTN if the collection account is fully enabled)`);
  } catch (e) { warn(`balance request failed (${(e as Error).message}); not fatal`); }

  try {
    const { prisma } = await import('../src/utils/prisma');
    await prisma.paymentTransaction.findFirst({ select: { receiptNumber: true, receiptEmailedAt: true } });
    ok('database has the receipt columns (migrations applied)');
    await prisma.$disconnect();
  } catch (e) { bad(`database check failed: ${(e as Error).message}. Run the migrations first.`); }
}

main().then(() => {
  console.log(blockers === 0 ? '\nGO: nothing blocks going live. Make one small real payment yourself to finish.\n' : `\nNO-GO: fix the ${blockers} item(s) marked \u2718 above.\n`);
  process.exit(blockers === 0 ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
