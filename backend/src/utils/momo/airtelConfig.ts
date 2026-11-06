/**
 * momo/airtelConfig.ts — environment configuration for Airtel Money (Uganda) collections.
 *
 * Works exactly like MTN MoMo: Airtel has its OWN ON/OFF switch, owned by the admin (Admin → Payments →
 * Airtel Money, persisted in SiteConfig.generalSettings.airtelEnabled and mirrored here by
 * utils/momo/airtelSwitch.ts). Until an admin has used the switch, AIRTEL_ENABLED is the default.
 * Airtel is LIVE only when the switch is ON AND the credentials are complete and consistent (fail-closed).
 * Independent of MTN: either network can be live without the other. Messages never contain secret values.
 */
import crypto from 'crypto';

export type AirtelEnvironment = 'sandbox' | 'production';

export interface AirtelConfig {
  enabled: boolean;
  environment: AirtelEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** ISO country for X-Country / subscriber.country (Uganda = UG). */
  country: string;
  /** Currency for X-Currency / transaction.currency (UGX). */
  currency: string;
  callbackSecret: string | null;
  timeoutMs: number;
}

export const AIRTEL_CALLBACK_PATH = '/api/payments/momo/airtel/callback';
const UAT_BASE_URL = 'https://openapiuat.airtel.africa';
const PRODUCTION_BASE_URL = 'https://openapi.airtel.africa';
const PLACEHOLDER_RE = /your[-_ ]|change[-_ ]?me|change[-_ ]?this|placeholder|example|here$/i;

type Env = Record<string, string | undefined>;
const clean = (v: string | undefined) => (v ?? '').trim();

function derivedSecret(env: Env): string | null {
  const base = clean(env.JWT_SECRET);
  if (base.length < 32) return null;
  return crypto.createHmac('sha256', base).update('piitrade-airtel-callback-v1').digest('hex');
}

// `null` = the admin has never used the switch -> AIRTEL_ENABLED decides. Kept in memory for synchronous callers.
let adminSwitch: boolean | null = null;
export function setAirtelAdminSwitch(value: boolean | null): void { adminSwitch = value; }
export function getAirtelAdminSwitch(): boolean | null { return adminSwitch; }

export function airtelSwitchedOn(env: Env = process.env, sw: boolean | null = adminSwitch): boolean {
  return sw ?? clean(env.AIRTEL_ENABLED).toLowerCase() === 'true';
}

export function loadAirtelConfig(env: Env = process.env): AirtelConfig {
  const environment: AirtelEnvironment = clean(env.AIRTEL_ENVIRONMENT).toLowerCase() === 'production' ? 'production' : 'sandbox';
  const timeout = parseInt(clean(env.AIRTEL_TIMEOUT_MS), 10);
  return {
    enabled: airtelSwitchedOn(env),
    environment,
    baseUrl: (clean(env.AIRTEL_BASE_URL) || (environment === 'sandbox' ? UAT_BASE_URL : PRODUCTION_BASE_URL)).replace(/\/+$/, ''),
    clientId: clean(env.AIRTEL_CLIENT_ID),
    clientSecret: clean(env.AIRTEL_CLIENT_SECRET),
    country: (clean(env.AIRTEL_COUNTRY) || 'UG').toUpperCase(),
    currency: (clean(env.AIRTEL_CURRENCY) || 'UGX').toUpperCase(),
    callbackSecret: clean(env.AIRTEL_CALLBACK_SECRET) || derivedSecret(env),
    timeoutMs: Number.isFinite(timeout) ? Math.min(60_000, Math.max(3_000, timeout)) : 20_000,
  };
}

/** Every reason the Airtel configuration is unusable (variable names only). Empty = good. */
export function describeAirtelConfigProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  const envName = clean(env.AIRTEL_ENVIRONMENT).toLowerCase();
  if (envName && envName !== 'sandbox' && envName !== 'production') problems.push('AIRTEL_ENVIRONMENT must be "sandbox" or "production"');
  const cfg = loadAirtelConfig(env);
  try {
    const u = new URL(cfg.baseUrl);
    const loopback = cfg.environment === 'sandbox' && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    if (u.protocol !== 'https:' && !loopback) problems.push('AIRTEL_BASE_URL must be an https URL');
  } catch {
    problems.push('AIRTEL_BASE_URL is not a valid URL');
  }
  if (!cfg.clientId) problems.push('AIRTEL_CLIENT_ID is not set');
  else if (PLACEHOLDER_RE.test(cfg.clientId)) problems.push('AIRTEL_CLIENT_ID still contains a placeholder value');
  if (!cfg.clientSecret) problems.push('AIRTEL_CLIENT_SECRET is not set');
  else if (PLACEHOLDER_RE.test(cfg.clientSecret)) problems.push('AIRTEL_CLIENT_SECRET still contains a placeholder value');
  if (cfg.country !== 'UG') problems.push('AIRTEL_COUNTRY must be UG');
  if (cfg.currency !== 'UGX') problems.push('AIRTEL_CURRENCY must be UGX');
  if (cfg.environment === 'production' && /openapiuat/i.test(cfg.baseUrl)) problems.push('AIRTEL_ENVIRONMENT=production but AIRTEL_BASE_URL points at the UAT sandbox');
  if (!cfg.callbackSecret) problems.push('AIRTEL_CALLBACK_SECRET is required (or a JWT_SECRET of 32+ characters to derive it)');
  else if (cfg.callbackSecret.length < 32) problems.push('AIRTEL_CALLBACK_SECRET must be at least 32 characters');
  return problems;
}

/** Switch ON (admin value, else AIRTEL_ENABLED) and credentials complete: Airtel can take NEW payments. */
export function isAirtelAvailable(env: Env = process.env, sw: boolean | null = adminSwitch): boolean {
  return airtelSwitchedOn(env, sw) && describeAirtelConfigProblems(env).length === 0;
}
export const isAirtelConfigured = isAirtelAvailable;

/** Payments already in flight can still be settled while Airtel is on, or paused by an admin with valid credentials. */
export function canSettleAirtel(env: Env = process.env, sw: boolean | null = adminSwitch): boolean {
  return isAirtelAvailable(env, sw) || (sw === false && describeAirtelConfigProblems(env).length === 0);
}

export interface AirtelStatus {
  enabled: boolean;
  switchedOn: boolean;
  switchSource: 'admin' | 'env';
  environment: AirtelEnvironment;
  problems: string[];
}

export function getAirtelStatus(env: Env = process.env, sw: boolean | null = adminSwitch): AirtelStatus {
  const problems = describeAirtelConfigProblems(env);
  const switchedOn = airtelSwitchedOn(env, sw);
  return { enabled: switchedOn && problems.length === 0, switchedOn, switchSource: sw === null ? 'env' : 'admin', environment: loadAirtelConfig(env).environment, problems };
}

/** The signed token the Airtel callback URL carries (Airtel has one registered callback URL, not one per payment). */
export function airtelCallbackToken(secret: string): string {
  return crypto.createHmac('sha256', secret).update('airtel-callback').digest('hex');
}

/** The callback URL to register in the Airtel developer portal (null when no public API origin is known). */
export function airtelCallbackUrl(env: Env = process.env): string | null {
  const cfg = loadAirtelConfig(env);
  const origin = clean(env.AIRTEL_CALLBACK_URL) || clean(env.API_BASE_URL);
  if (!origin || !cfg.callbackSecret) return null;
  try {
    const u = new URL(origin);
    if (u.pathname === '' || u.pathname === '/') u.pathname = AIRTEL_CALLBACK_PATH;
    u.search = '';
    u.searchParams.set('s', airtelCallbackToken(cfg.callbackSecret));
    return u.toString();
  } catch {
    return null;
  }
}

/** One startup line. Called from index.ts next to the MTN one. */
export function airtelStatusLine(env: Env = process.env): string {
  if (!airtelSwitchedOn(env)) return `Airtel Money: switched OFF (${adminSwitch === null ? 'AIRTEL_ENABLED is not true' : 'by an admin'}); turn it on in Admin → Payments.`;
  const problems = describeAirtelConfigProblems(env);
  const cfg = loadAirtelConfig(env);
  if (problems.length) return `Airtel Money: switched ON but the configuration is unusable — stays DISABLED. Problems: ${problems.join('; ')}`;
  return `Airtel Money: enabled (${cfg.environment}, ${cfg.country}/${cfg.currency}); callbacks ${airtelCallbackUrl(env) ? 'URL ready (register it in the Airtel portal; see /api/payments/momo/airtel/callback)' : 'off (API_BASE_URL not set) — polling only'}`;
}
