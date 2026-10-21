/**
 * MTN Mobile Money (MoMo) payments — client helpers.
 *
 * The server is the single source of truth: it derives the amount from the thing being bought and
 * decides when a payment is complete. The browser only starts a payment and polls its status, so
 * nothing here can mark anything paid. `useMomoConfig()` tells the UI whether MoMo is switched on;
 * while it is off every page keeps its existing manual payment-reference flow.
 */
import { useEffect, useState } from 'react';
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

export type MomoPaymentStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'EXPIRED' | 'NEEDS_REVIEW';

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
  /** false while loading, when MoMo is off, and when the check fails — i.e. the manual flow stays. */
  enabled: boolean;
  loading: boolean;
  /** true when the server is talking to MTN's sandbox (no real money moves). */
  sandbox: boolean;
}

let configPromise: Promise<{ enabled: boolean; sandbox: boolean }> | null = null;

function loadConfig(): Promise<{ enabled: boolean; sandbox: boolean }> {
  if (!configPromise) {
    configPromise = api
      .get('/payments/config')
      .then(({ data }) => ({ enabled: data?.momoEnabled === true, sandbox: data?.environment === 'sandbox' }))
      .catch(() => {
        configPromise = null; // don't cache a failure: the next page load asks again
        return { enabled: false, sandbox: false };
      });
  }
  return configPromise;
}

export function useMomoConfig(): MomoConfigState {
  const [state, setState] = useState<MomoConfigState>({ enabled: false, loading: true, sandbox: false });
  useEffect(() => {
    let alive = true;
    loadConfig().then((c) => { if (alive) setState({ ...c, loading: false }); });
    return () => { alive = false; };
  }, []);
  return state;
}
