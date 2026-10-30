/**
 * momo/config.ts — environment configuration for the MTN MoMo (collection-only) integration.
 *
 * Credentials and endpoints come from environment variables (see backend/.env.example); the ON/OFF
 * switch is owned by the admin (Admin → MoMo Payments, persisted in SiteConfig.generalSettings and
 * mirrored here by utils/momo/switch.ts). Until an admin has ever used the switch, the MTN_ENABLED
 * variable is the default, so existing deployments behave exactly as before.
 *
 * MoMo is LIVE only when the switch is ON AND the configuration is complete and consistent. While it
 * is off the platform behaves exactly as before (manual payment reference confirmed by an admin).
 *
 * Fail-closed on misconfiguration: if the switch is ON but something is wrong (missing key,
 * sandbox values pointing at production, placeholder secrets…) the integration stays disabled and
 * the problems are logged — it never half-works with real money. Messages never contain secrets.
 */
import crypto from 'crypto';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../logger';

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

// ── The ON/OFF switch ────────────────────────────────────────────────────────────────────────────
// `null` = the admin has never used the switch → fall back to MTN_ENABLED. Kept in memory so the many
// synchronous callers need no DB read; utils/momo/switch.ts loads it at startup, after every admin
// change, and re-syncs it periodically so several server instances agree.
let adminSwitch: boolean | null = null;

export function setMomoAdminSwitch(value: boolean | null): void {
  adminSwitch = value;
}

export function getMomoAdminSwitch(): boolean | null {
  return adminSwitch;
}

/** Where the current ON/OFF answer comes from. */
export function momoSwitchSource(sw: boolean | null = adminSwitch): 'admin' | 'env' {
  return sw === null ? 'env' : 'admin';
}

/** The switch alone (admin value, else MTN_ENABLED) — says nothing about whether the credentials are usable. */
export function momoSwitchedOn(env: Env = process.env, sw: boolean | null = adminSwitch): boolean {
  return sw ?? clean(env.MTN_ENABLED).toLowerCase() === 'true';
}

export function loadMomoConfig(env: Env = process.env): MomoConfig {
  const environment: MomoEnvironment = clean(env.MTN_ENVIRONMENT).toLowerCase() === 'production' ? 'production' : 'sandbox';
  const baseRaw = clean(env.MTN_BASE_URL) || (environment === 'sandbox' ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL);
  const apiBase = clean(env.API_BASE_URL).replace(/\/+$/, '');
  const callbackRaw = clean(env.MTN_CALLBACK_URL) || (apiBase ? `${apiBase}${CALLBACK_PATH}` : '');
  const timeout = parseInt(clean(env.MTN_TIMEOUT_MS), 10);
  return {
    enabled: momoSwitchedOn(env),
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

/** True only when the switch is ON (admin value, else MTN_ENABLED) and the configuration is complete and consistent. */
export function isMomoEnabled(env: Env = process.env, sw: boolean | null = adminSwitch): boolean {
  return momoSwitchedOn(env, sw) && describeMomoConfigProblems(env).length === 0;
}

export interface MomoStatus {
  /** Is MoMo actually live for customers right now. */
  enabled: boolean;
  /** The ON/OFF switch on its own. */
  switchedOn: boolean;
  /** Who set the switch: an admin, or (never used yet) the MTN_ENABLED variable. */
  switchSource: 'admin' | 'env';
  environment: MomoEnvironment;
  /** Credential/config problems by variable name only — never a value. Empty when the credentials are usable. */
  problems: string[];
}

/** Everything the admin screen needs to explain the current state. */
export function getMomoStatus(env: Env = process.env, sw: boolean | null = adminSwitch): MomoStatus {
  const problems = describeMomoConfigProblems(env);
  const switchedOn = momoSwitchedOn(env, sw);
  return {
    enabled: switchedOn && problems.length === 0,
    switchedOn,
    switchSource: momoSwitchSource(sw),
    environment: loadMomoConfig(env).environment,
    problems,
  };
}

/** The validated configuration for NEW payments, or a 503 when the integration is off / misconfigured. */
export function getMomoConfig(env: Env = process.env): MomoConfig {
  if (!isMomoEnabled(env)) throw createError('Mobile money payments are not available right now.', 503);
  return loadMomoConfig(env);
}

/**
 * Can payments that are ALREADY in flight still be settled? Yes while MoMo is on, and also while an admin has
 * paused it (an explicit OFF) with valid credentials: a customer who approved the prompt on their phone before
 * the switch was turned off must still be credited. Turning the switch off stops NEW payments only.
 * With no admin choice and MTN_ENABLED off nothing was ever started, so nothing runs (the original behaviour).
 */
export function canSettleMomo(env: Env = process.env, sw: boolean | null = adminSwitch): boolean {
  if (isMomoEnabled(env, sw)) return true;
  return sw === false && describeMomoConfigProblems(env).length === 0;
}

/** The configuration for settling payments already in flight (MTN callback, status polling, reconciler); 503 when it cannot. */
export function getMomoSettlementConfig(env: Env = process.env): MomoConfig {
  if (!canSettleMomo(env)) throw createError('Mobile money payments are not available right now.', 503);
  return loadMomoConfig(env);
}

/** One startup line (and loud errors for a misconfiguration). Called once from index.ts. */
export function logMomoConfigStatus(env: Env = process.env, sw: boolean | null = adminSwitch): void {
  if (!momoSwitchedOn(env, sw)) {
    logger.info(`MTN MoMo: switched OFF (${momoSwitchSource(sw) === 'admin' ? 'by an admin' : 'MTN_ENABLED is not true'}); turn it on in Admin → MoMo Payments. Manual payment confirmation stays in effect.`);
    return;
  }
  const problems = describeMomoConfigProblems(env);
  if (problems.length > 0) {
    logger.error(`MTN MoMo: switched ON but the configuration is unusable — integration stays DISABLED. Problems: ${problems.join('; ')}`);
    return;
  }
  const cfg = loadMomoConfig(env);
  logger.info(`MTN MoMo: enabled (${cfg.environment}, target=${cfg.targetEnvironment}, currency=${cfg.currency}, callbacks=${cfg.callbackUrl ? 'on' : 'off (polling only)'})`);
}
