/**
 * One-time MTN MoMo SANDBOX provisioning (the "triple-lock" bootstrap):
 *   1. generate an API User id (UUID v4) and register it      POST /v1_0/apiuser
 *   2. ask MTN for that user's API Key                         POST /v1_0/apiuser/{uuid}/apikey
 *   3. prove the pair works by requesting an access token      POST /collection/token/
 *
 *   MTN_SUBSCRIPTION_KEY=<primary key of the Collections product> npm run momo:sandbox:provision
 *   optional: --callback-host api.example.com   (host MTN may call back; defaults to the host of
 *             MTN_CALLBACK_URL / API_BASE_URL, else webhook.site => polling-only testing)
 *
 * SANDBOX ONLY: it refuses to run against anything that is not the MTN sandbox. In production MTN
 * provisions the API user/key for you through the partner portal. The API key is printed ONCE to
 * the terminal (MTN cannot show it again) and is never written to a file or a log.
 */
import crypto from 'crypto';
import path from 'path';
import { config as loadEnv } from 'dotenv';

const projectRoot = path.resolve(__dirname, '..');
for (const envFile of ['.env.local', '.env', '../.env']) loadEnv({ path: path.resolve(projectRoot, envFile) });

const SANDBOX_URL = 'https://sandbox.momodeveloper.mtn.com';

function fail(message: string): never {
  console.error(`[momo-sandbox] ${message}`);
  process.exit(1);
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

async function main(): Promise<void> {
  const subscriptionKey = (process.env.MTN_SUBSCRIPTION_KEY ?? '').trim();
  if (!subscriptionKey) fail('MTN_SUBSCRIPTION_KEY is not set (the primary key of your Collections subscription).');
  if ((process.env.MTN_ENVIRONMENT ?? '').trim().toLowerCase() === 'production') fail('MTN_ENVIRONMENT=production — this script only provisions the sandbox.');

  const baseUrl = ((process.env.MTN_BASE_URL ?? '').trim() || SANDBOX_URL).replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { return fail('MTN_BASE_URL is not a valid URL.'); }
  const isLocalTestServer = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (!/sandbox/i.test(parsed.hostname) && !isLocalTestServer) fail(`Refusing to provision against ${parsed.host}: it is not the MTN sandbox.`);

  const callbackHost = argValue('--callback-host') ?? hostOf(process.env.MTN_CALLBACK_URL) ?? hostOf(process.env.API_BASE_URL) ?? 'webhook.site';
  const apiUser = crypto.randomUUID();

  const call = async (method: string, urlPath: string, init: { headers?: Record<string, string>; body?: unknown } = {}) =>
    fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: { 'Ocp-Apim-Subscription-Key': subscriptionKey, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  console.log(`[momo-sandbox] registering API user ${apiUser} (callback host: ${callbackHost}) …`);
  const created = await call('POST', '/v1_0/apiuser', { headers: { 'X-Reference-Id': apiUser }, body: { providerCallbackHost: callbackHost } });
  if (created.status !== 201) fail(`Creating the API user failed (HTTP ${created.status}). Check MTN_SUBSCRIPTION_KEY.`);

  console.log('[momo-sandbox] requesting the API key …');
  const keyRes = await call('POST', `/v1_0/apiuser/${apiUser}/apikey`);
  if (!keyRes.ok) fail(`Creating the API key failed (HTTP ${keyRes.status}).`);
  const apiKey = ((await keyRes.json().catch(() => null)) as { apiKey?: unknown } | null)?.apiKey;
  if (typeof apiKey !== 'string' || !apiKey) fail('MTN did not return an API key.');

  console.log('[momo-sandbox] verifying the credentials with a token request …');
  const basic = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
  const tokenRes = await call('POST', '/collection/token/', { headers: { Authorization: `Basic ${basic}` } });
  if (!tokenRes.ok) fail(`The new credentials could not obtain a token (HTTP ${tokenRes.status}).`);

  console.log('\n[momo-sandbox] OK — add these to your backend environment (the key is shown only now):\n');
  console.log('MTN_ENABLED=true');
  console.log('MTN_ENVIRONMENT=sandbox');
  console.log('MTN_TARGET_ENVIRONMENT=sandbox');
  console.log(`MTN_BASE_URL=${baseUrl}`);
  console.log('MTN_CURRENCY=EUR            # the sandbox only accepts EUR');
  console.log(`MTN_API_USER=${apiUser}`);
  console.log(`MTN_API_KEY=${apiKey}`);
  console.log('# MTN_SUBSCRIPTION_KEY stays as you already have it.');
  console.log('# MTN_CALLBACK_SECRET=$(openssl rand -hex 32)   and   MTN_CALLBACK_URL / API_BASE_URL = your backend\'s public https origin');
  if (callbackHost === 'webhook.site') console.log('\n# Callback host is webhook.site: MTN callbacks will NOT reach this backend — payments settle by polling only.');
  else console.log(`\n# MTN will only call back hosts matching "${callbackHost}" — keep MTN_CALLBACK_URL on that host.`);
}

main().catch((err) => fail(`Unexpected error: ${(err as Error).message}`));
