/**
 * momo/config.ts — environment configuration for the MTN MoMo (collection-only) integration.
 *
 * Credentials and endpoints are environment variables (see backend/.env.example). Whether MoMo is
 * ON is decided in this order:
 *   1. the admin's switch (Admin → MoMo Payments / Settings, stored in the database), when the admin has set it;
 *   2. otherwise the MTN_ENABLED environment variable (the original behaviour).
 * Either way the integration is only usable when the configuration is complete and consistent; while it is off
 * the platform behaves exactly as before (manual payment reference confirmed by an admin).
 *
 * Switching OFF stops NEW payments only. Payments the customer already approved on their phone keep being
 * settled (callback, polling, reconciler) as long as the credentials are valid — see canSettleMomo().
 *
 * Fail-closed on misconfiguration: if MTN_ENABLED=true but something is wrong (missing key,
 * sandbox values pointing at production, placeholder secrets…) the integration stays disabled and
 * the problems are logged — it never half-works with real money. Messages never contain secrets.
 */
import crypto from 'crypto';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../logger';
import { getMomoAdminSwitch } from './adminSwitch';

export type MomoEnvironment = 'sandbox' | 'production';

export interface MomoConfig {
  enabled: boolean;
  environment: MomoEnvironment;
  /** Value of the X-Target-Environment header ("sandbox" in sandbox; MTN's country value in production, e.g. "mtnuganda"). */
  targetEnvironment: string;
  /** API base URL without a trailing slash. */
  baseUrl: string;
  /** Primary subscription key of the *Collections* product (Ocp-Apim-Subscription-Key). */
  subscriptionKey: string;
  /** API User (the UUID registered with MTN). */
  apiUser: string;
  /** API Key (secret). Never logged. */
  apiKey: string;
  /** Full https URL MTN calls back (null => polling only, no X-Callback-Url is sent). */
  callbackUrl: string | null;
  /** HMAC secret that signs the per-payment callback URL. */
  callbackSecret: string | null;
  /** Currency sent to MTN. The sandbox only accepts EUR; production is UGX. */
  currency: string;
  timeoutMs: number;
}

export const CALLBACK_PATH = '/api/payments/momo/callback';
const SANDBOX_BASE_URL = 'https://sandbox.momodeveloper.mtn.com';
// MTN's production API gateway. Confirm against the onboarding pack MTN sends when you go live.
const PRODUCTION_BASE_URL = 'https://proxy.momoapi.mtn.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_RE = /your[-_ ]|change[-_ ]?me|change[-_ ]?this|placeholder|example|here$/i;

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * MTN_CALLBACK_URL may be given as a bare origin ("https://api.example.com"); the callback route
 * path is appended in that case. A URL that already has a path is kept as-is.
 */
export function normalizeCallbackUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.pathname === '' || u.pathname === '/') u.pathname = CALLBACK_PATH;
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * When MTN_CALLBACK_SECRET is not set, derive the callback-signing secret from the server's JWT_SECRET
 * (HMAC with a fixed label) so enabling MoMo cannot silently fail for lack of one more variable.
 * An explicit MTN_CALLBACK_SECRET always wins.
 */
function derivedCallbackSecret(env: Env): string | null {
  const base = clean(env.JWT_SECRET);
  if (base.length < 32) return null;
  return crypto.createHmac('sha256', base).update('piitrade-momo-callback-v1').digest('hex');
}

/** Is MoMo switched on? The admin's switch wins; with none set, MTN_ENABLED decides. */
export function isMomoSwitchedOn(env: Env = process.env): boolean {
  const admin = getMomoAdminSwitch();
  return admin !== null ? admin : clean(env.MTN_ENABLED).toLowerCase() === 'true';
}

/** Where the on/off decision currently comes from. */
export function momoSwitchSource(): 'admin' | 'env' {
  return getMomoAdminSwitch() !== null ? 'admin' : 'env';
}

export function loadMomoConfig(env: Env = process.env): MomoConfig {
  const environment: MomoEnvironment = clean(env.MTN_ENVIRONMENT).toLowerCase() === 'production' ? 'production' : 'sandbox';
  const baseRaw = clean(env.MTN_BASE_URL) || (environment === 'sandbox' ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL);
  const apiBase = clean(env.API_BASE_URL).replace(/\/+$/, '');
  const callbackRaw = clean(env.MTN_CALLBACK_URL) || (apiBase ? `${apiBase}${CALLBACK_PATH}` : '');
  const timeout = parseInt(clean(env.MTN_TIMEOUT_MS), 10);
  return {
    enabled: isMomoSwitchedOn(env),
    environment,
    targetEnvironment: clean(env.MTN_TARGET_ENVIRONMENT) || (environment === 'sandbox' ? 'sandbox' : ''),
    baseUrl: baseRaw.replace(/\/+$/, ''),
    subscriptionKey: clean(env.MTN_SUBSCRIPTION_KEY),
    apiUser: clean(env.MTN_API_USER),
    apiKey: clean(env.MTN_API_KEY),
    callbackUrl: normalizeCallbackUrl(callbackRaw),
    callbackSecret: clean(env.MTN_CALLBACK_SECRET) || derivedCallbackSecret(env),
    currency: (clean(env.MTN_CURRENCY) || (environment === 'sandbox' ? 'EUR' : 'UGX')).toUpperCase(),
    timeoutMs: Number.isFinite(timeout) ? Math.min(60_000, Math.max(3_000, timeout)) : 20_000,
  };
}

/** Every reason the configuration is unusable. Never includes secret values. Empty = good. */
export function describeMomoConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  const envName = clean(env.MTN_ENVIRONMENT).toLowerCase();
  if (envName && envName !== 'sandbox' && envName !== 'production') problems.push('MTN_ENVIRONMENT must be "sandbox" or "production"');

  const cfg = loadMomoConfig(env);
  if (!cfg.baseUrl) problems.push('MTN_BASE_URL is not set');
  else {
    try {
      const u = new URL(cfg.baseUrl);
      // Plain http is allowed ONLY for a loopback host in sandbox mode (local mock server in tests).
      const loopbackSandbox = cfg.environment === 'sandbox' && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
      if (u.protocol !== 'https:' && !loopbackSandbox) problems.push('MTN_BASE_URL must be an https URL');
    } catch {
      problems.push('MTN_BASE_URL is not a valid URL');
    }
  }
  if (!cfg.targetEnvironment) problems.push('MTN_TARGET_ENVIRONMENT is not set');
  if (!cfg.subscriptionKey) problems.push('MTN_SUBSCRIPTION_KEY is not set');
  else if (PLACEHOLDER_RE.test(cfg.subscriptionKey)) problems.push('MTN_SUBSCRIPTION_KEY still contains a placeholder value');
  if (!cfg.apiUser) problems.push('MTN_API_USER is not set');
  else if (!UUID_RE.test(cfg.apiUser)) problems.push('MTN_API_USER must be a UUID');
  if (!cfg.apiKey) problems.push('MTN_API_KEY is not set');
  else if (PLACEHOLDER_RE.test(cfg.apiKey)) problems.push('MTN_API_KEY still contains a placeholder value');

  // Sandbox credentials must never be mixed with production endpoints (or the reverse).
  if (cfg.environment === 'production') {
    if (/sandbox/i.test(cfg.baseUrl) || /sandbox/i.test(cfg.targetEnvironment)) {
      problems.push('MTN_ENVIRONMENT=production but MTN_BASE_URL / MTN_TARGET_ENVIRONMENT point at the sandbox');
    }
    if (cfg.currency !== 'UGX') problems.push('MTN_CURRENCY must be UGX in production');
  } else if (cfg.targetEnvironment && cfg.targetEnvironment !== 'sandbox') {
    problems.push('MTN_ENVIRONMENT=sandbox requires MTN_TARGET_ENVIRONMENT=sandbox');
  }

  const callbackRaw = clean(env.MTN_CALLBACK_URL);
  if (callbackRaw && !cfg.callbackUrl) problems.push('MTN_CALLBACK_URL is not a valid URL');
  if (cfg.callbackUrl) {
    if (cfg.environment === 'production' && !cfg.callbackUrl.startsWith('https://')) problems.push('MTN_CALLBACK_URL must be https in production');
    if (!cfg.callbackSecret) problems.push('MTN_CALLBACK_SECRET is required when a callback URL is configured');
    else if (cfg.callbackSecret.length < 32) problems.push('MTN_CALLBACK_SECRET must be at least 32 characters');
  }
  return problems;
}

/** True only when MoMo is switched on (admin switch, else MTN_ENABLED) and the configuration is complete and consistent. Gates NEW payments. */
export function isMomoEnabled(env: Env = process.env): boolean {
  return isMomoSwitchedOn(env) && describeMomoConfigProblems(env).length === 0;
}

/**
 * Can payments that are ALREADY in flight still be settled? Yes while MoMo is on, and also while an admin
 * has paused it (explicit OFF) with valid credentials: a customer who approved the prompt before the switch
 * was turned off must still be credited. With no admin switch and MTN_ENABLED off nothing is ever started, so nothing runs.
 */
export function canSettleMomo(env: Env = process.env): boolean {
  if (isMomoEnabled(env)) return true;
  return getMomoAdminSwitch() === false && describeMomoConfigProblems(env).length === 0;
}

/** The validated configuration for NEW payments, or a 503 when the integration is off / misconfigured. */
export function getMomoConfig(env: Env = process.env): MomoConfig {
  if (!isMomoEnabled(env)) throw createError('Mobile money payments are not available right now.', 503);
  return loadMomoConfig(env);
}

/** The configuration for settling payments already in flight (callback, polling, reconciler); 503 when it cannot. */
export function getMomoSettlementConfig(env: Env = process.env): MomoConfig {
  if (!canSettleMomo(env)) throw createError('Mobile money payments are not available right now.', 503);
  return loadMomoConfig(env);
}

/** One startup line (and loud errors for a misconfiguration). Called once from index.ts after the admin switch is loaded. */
export function logMomoConfigStatus(env: Env = process.env): void {
  if (!isMomoSwitchedOn(env)) {
    logger.info(momoSwitchSource() === 'admin'
      ? 'MTN MoMo: switched OFF by an admin (Admin → MoMo Payments). Manual payment confirmation stays in effect.'
      : 'MTN MoMo: disabled (set MTN_ENABLED=true or switch it on in Admin → MoMo Payments). Manual payment confirmation stays in effect.');
    return;
  }
  const problems = describeMomoConfigProblems(env);
  if (problems.length > 0) {
    logger.error(`MTN MoMo: switched on but the configuration is unusable — integration stays DISABLED. Problems: ${problems.join('; ')}`);
    return;
  }
  const cfg = loadMomoConfig(env);
  logger.info(`MTN MoMo: enabled (${cfg.environment}, target=${cfg.targetEnvironment}, currency=${cfg.currency}, callbacks=${cfg.callbackUrl ? 'on' : 'off (polling only)'})`);
}
