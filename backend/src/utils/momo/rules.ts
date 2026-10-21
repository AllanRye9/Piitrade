/**
 * momo/rules.ts — pure rules for the MoMo integration (no database, no network). Unit-tested.
 */
import crypto from 'crypto';
import { safeEqual } from '../safeEqual';

export type ProviderOutcome = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

/**
 * MTN reports PENDING / SUCCESSFUL / FAILED (rejections and timeouts arrive as FAILED with a
 * reason). Anything unrecognised is treated as still PENDING — never as paid.
 */
export function mapProviderStatus(raw: unknown): ProviderOutcome {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (s === 'SUCCESSFUL') return 'SUCCESSFUL';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'TIMEOUT') return 'FAILED';
  return 'PENDING';
}

/**
 * Normalise a payer phone number to MSISDN form (digits only, country code, no "+").
 * Uganda (MTN ranges 076/077/078/039 only): 0772123456 / +256772123456 / 772123456 -> 256772123456.
 * `lenient` (sandbox only) also accepts the sandbox's international test numbers (e.g. 46733123450).
 * Returns null when the number is not usable.
 */
export function normalizeMsisdn(raw: unknown, opts: { lenient?: boolean } = {}): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return null;
  let msisdn: string | null = null;
  if (/^256\d{9}$/.test(digits)) msisdn = digits;
  else if (/^0\d{9}$/.test(digits)) msisdn = `256${digits.slice(1)}`;
  else if (/^[1-9]\d{8}$/.test(digits)) msisdn = `256${digits}`;
  // MTN Uganda number ranges: 077x, 078x, 076x and 039x. Airtel/Lyca/UTL numbers cannot be charged here.
  if (msisdn && /^256(77|78|76|39)\d{7}$/.test(msisdn)) return msisdn;
  if (opts.lenient && /^\d{9,15}$/.test(digits)) return msisdn ?? digits;
  return null;
}

/** "256772123456" -> "256*****456" — for logs and API responses; the full number is never logged. */
export function maskMsisdn(msisdn: string): string {
  if (msisdn.length <= 6) return '***';
  return `${msisdn.slice(0, 3)}${'*'.repeat(msisdn.length - 6)}${msisdn.slice(-3)}`;
}

/** UGX has no minor unit: whole shillings as a plain integer string ("60000"). Throws on <= 0 / non-finite. */
export function formatProviderAmount(amount: number): string {
  if (!Number.isFinite(amount)) throw new Error('amount must be a finite number');
  const whole = Math.round(amount);
  if (whole <= 0) throw new Error('amount must be greater than zero');
  return String(whole);
}

// ─── Status-check schedule ──────────────────────────────────────────────────

/** Gap before the next status check: quick at first (the payer is looking at their phone), then relaxed. */
const CHECK_DELAYS_SECONDS = [5, 5, 10, 10, 15, 15, 20, 30];
const CHECK_DELAY_CAP_SECONDS = 60;

export function checkDelayMs(checkCount: number): number {
  const i = Math.max(0, Math.floor(checkCount));
  return (i < CHECK_DELAYS_SECONDS.length ? CHECK_DELAYS_SECONDS[i] : CHECK_DELAY_CAP_SECONDS) * 1000;
}

export function isDueForCheck(row: { lastCheckedAt: Date | null; checkCount: number }, now: Date = new Date()): boolean {
  if (!row.lastCheckedAt) return true;
  return now.getTime() - row.lastCheckedAt.getTime() >= checkDelayMs(row.checkCount);
}

/** A PENDING attempt older than this is given up on locally so the payer can start a fresh one. */
export const PENDING_GIVE_UP_MS = 5 * 60 * 1000;
/** How long an EXPIRED attempt keeps being re-checked, so a very late approval is never missed. */
export const LATE_SUCCESS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Re-check gap for EXPIRED attempts inside the late-success window. */
export const EXPIRED_RECHECK_MS = 5 * 60 * 1000;

// ─── Callback signing ───────────────────────────────────────────────────────
// MTN callbacks are unsigned, so each payment gets its own callback URL carrying an HMAC of its
// reference. Even a forged callback can only make us re-verify with MTN — it never decides anything.

export function signCallback(referenceId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(referenceId).digest('hex');
}

export function verifyCallbackSignature(referenceId: string, signature: unknown, secret: string): boolean {
  return safeEqual(signature, signCallback(referenceId, secret));
}

// ─── Text sent to the payer / payee ─────────────────────────────────────────

/** MTN limits these notes; keep them short, plain ASCII, no user-controlled text. */
export function paymentNote(label: string): string {
  return `Piitrade ${label}`.replace(/[^\x20-\x7E]/g, '').slice(0, 60);
}

// ─── Failure wording shown to the payer ─────────────────────────────────────

/** MTN's failure reason code -> a short message the payer can act on. Never leaks provider internals. */
export function friendlyFailure(reason: string | null | undefined): string {
  const r = (reason ?? '').toUpperCase();
  if (r.includes('NOT_ENOUGH_FUNDS') || r.includes('INSUFFICIENT')) return 'Your mobile money balance is too low for this payment.';
  if (r.includes('PAYER_LIMIT_REACHED')) return 'You have reached your mobile money transaction limit. Try a smaller amount later or contact MTN.';
  if (r.includes('REJECT') || r.includes('DECLINE') || r.includes('CANCEL') || r.includes('NOT_APPROVED')) return 'The payment was declined on your phone.';
  if (r.includes('SERVICE_UNAVAILABLE') || r.includes('INTERNAL_PROCESSING_ERROR')) return 'MTN Mobile Money is temporarily unavailable. You have not been charged — please try again in a few minutes.';
  if (r.includes('EXPIRED') || r.includes('TIMEOUT')) return 'The payment request timed out before it was approved.';
  if (r.includes('PAYER_NOT_FOUND') || r.includes('NOT_FOUND_AT_PROVIDER')) return 'That number could not be charged. Check it is an active MTN Mobile Money number.';
  return 'The payment did not go through. You have not been charged — please try again.';
}
