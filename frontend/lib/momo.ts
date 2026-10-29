/**
 * MTN Mobile Money (MoMo) payments — client helpers.
 *
 * The server is the single source of truth: it derives the amount from the thing being bought and
 * decides when a payment is complete. The browser only starts a payment and polls its status, so
 * nothing here can mark anything paid. `useMomoConfig()` tells the UI whether MoMo is switched on;
 * while it is off every page keeps its existing manual payment-reference flow.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type MomoPurpose =
  | 'SUBSCRIPTION'
  | 'SUBSCRIPTION_RENEWAL'
  | 'SUBSCRIPTION_UPGRADE'
  | 'STORE_RENTAL'
  | 'STORE_RENEWAL'
  | 'LISTING_TIER'
  | 'CV_DOWNLOAD';

/** What to buy. The amount is deliberately NOT part of this — the server prices it. */
export interface MomoInitiateRequest {
  purpose: MomoPurpose;
  packageId?: string;
  /** Upgrades only: when the new plan starts. */
  upgradeMode?: 'AFTER_EXPIRY' | 'IMMEDIATE';
  subscriptionId?: string;
  rentalId?: string;
  listingId?: string;
  tier?: 'GOLD' | 'PLATINUM';
  tokenId?: string;
  /** CV download token secret: proves ownership for guests (no account) and is also used when polling. */
  rawToken?: string;
}

export type MomoPaymentStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'EXPIRED' | 'NEEDS_REVIEW' | 'REFUNDED';

export interface MomoPayment {
  id: string;
  purpose: MomoPurpose;
  targetId: string;
  status: MomoPaymentStatus;
  /** true once the payment succeeded AND the access it buys has been granted. */
  completed: boolean;
  amount: number;
  currency: string;
  /** Masked, e.g. 256******456. */
  msisdn: string;
  failureMessage: string | null;
  /** Unique tracking code of the digital receipt, once the payment has completed. */
  receiptNumber: string | null;
  createdAt: string;
}

export async function initiateMomoPayment(req: MomoInitiateRequest, msisdn: string): Promise<{ payment: MomoPayment; resumed: boolean }> {
  const { data } = await api.post('/payments/momo/initiate', { ...req, msisdn });
  return data as { payment: MomoPayment; resumed: boolean };
}

/** Poll a payment. POST so a guest's CV token secret travels in the body, never in a URL. */
export async function fetchMomoPayment(id: string, rawToken?: string): Promise<MomoPayment> {
  const { data } = await api.post(`/payments/${encodeURIComponent(id)}/status`, rawToken ? { rawToken } : {});
  return (data as { payment: MomoPayment }).payment;
}

// ─── Receipts ───────────────────────────────────────────────────────────────

export interface MomoReceipt {
  paymentId: string;
  /** Unique tracking code, e.g. PTR-7K2M-9QXA-4D8H (TST-… for sandbox test payments). */
  receiptNumber: string;
  item: string;
  amount: number;
  currency: string;
  issuedAt: string;
  /** The PDF has been emailed to the payer. */
  emailed: boolean;
  isTest: boolean;
}

export type ReceiptCheck =
  | { valid: false }
  | { valid: true; receiptNumber: string; item: string; amount: number; currency: string; issuedAt: string; isTest: boolean; status: 'PAID' };

export async function fetchMyReceipts(): Promise<MomoReceipt[]> {
  const { data } = await api.get('/payments/receipts');
  return (data as { receipts: MomoReceipt[] }).receipts;
}

/** Downloads the receipt PDF (the server rebuilds it from the payment record each time). */
export async function downloadReceiptPdf(paymentId: string, receiptNumber?: string | null): Promise<void> {
  const { data } = await api.get(`/payments/${encodeURIComponent(paymentId)}/receipt.pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Piitrade-receipt-${receiptNumber ?? paymentId}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Email the receipt PDF to the signed-in payer again. Resolves false when there is no address on file. */
export async function emailReceiptAgain(paymentId: string): Promise<boolean> {
  const { data } = await api.post(`/payments/${encodeURIComponent(paymentId)}/receipt/email`, {});
  return (data as { sent: boolean }).sent;
}

/** Public: is this receipt tracking code genuine? */
export async function verifyReceiptCode(code: string): Promise<ReceiptCheck> {
  const { data } = await api.get('/payments/receipts/verify', { params: { code } });
  return data as ReceiptCheck;
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof msg === 'string' && msg ? msg : fallback;
}

export function apiErrorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

export function formatMomoAmount(currency: string, amount: number): string {
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
}

// ── Config (is MoMo switched on?) ─────────────────────────────────────────────

export interface MomoConfigState {
  /** false while loading, when MoMo is off, and when the check fails. */
  enabled: boolean;
  loading: boolean;
  /** true when the server is talking to MTN's sandbox (no real money moves). */
  sandbox: boolean;
  /**
   * true when the config request itself failed (network / server error), as opposed to the server
   * answering that MoMo is switched off. Lets a page say "couldn't check" and offer a retry instead of
   * claiming MoMo is unavailable.
   */
  failed: boolean;
  /** Ask the server again (e.g. after a transient failure). */
  retry: () => void;
}

type LoadedConfig = { enabled: boolean; sandbox: boolean; failed: boolean };

let configPromise: Promise<LoadedConfig> | null = null;
let configLoadedAt = 0;
// An admin can switch MoMo on or off at any time, so the answer is reused for 30 s at most.
const CONFIG_TTL_MS = 30_000;

function loadConfig(): Promise<LoadedConfig> {
  if (configPromise && Date.now() - configLoadedAt > CONFIG_TTL_MS) configPromise = null;
  if (!configPromise) {
    configLoadedAt = Date.now();
    configPromise = api
      .get('/payments/config')
      .then(({ data }): LoadedConfig => ({ enabled: data?.momoEnabled === true, sandbox: data?.environment === 'sandbox', failed: false }))
      .catch((): LoadedConfig => {
        configPromise = null; // don't cache a failure: the next page load (or retry) asks again
        return { enabled: false, sandbox: false, failed: true };
      });
  }
  return configPromise;
}

export function useMomoConfig(): MomoConfigState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<MomoConfigState, 'retry'>>({ enabled: false, loading: true, sandbox: false, failed: false });
  useEffect(() => {
    let alive = true;
    loadConfig().then((c) => { if (alive) setState({ ...c, loading: false }); });
    return () => { alive = false; };
  }, [attempt]);
  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, failed: false }));
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}
