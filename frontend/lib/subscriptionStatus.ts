'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { PackageScope, SellerSubscription } from '@/lib/types';

/**
 * One model of "where does this account stand" for subscriptions and web-store rentals.
 *
 *   ACTIVE    – currently grants access
 *   PENDING   – a payment-pending request is waiting for an admin to confirm
 *   EXPIRED   – the latest term ran out (renewable)
 *   CANCELLED – ended by the owner / admin
 *   NONE      – never subscribed
 *
 * The API derives status from the dates at request time, so these values are
 * already real-time; the hooks below just re-ask on focus and every 30 s.
 */
export type AccessState = 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'CANCELLED' | 'NONE';

export const STATE_META: Record<AccessState, { label: string; badge: string; dot: string }> = {
  ACTIVE: { label: 'Active', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  PENDING: { label: 'Pending', badge: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  EXPIRED: { label: 'Expired', badge: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
  NONE: { label: 'No plan', badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
};

export function daysBetween(endDate: string | Date, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - now) / 86_400_000));
}

/** Web-store rental status, corrected for an end date that has already passed. */
export function effectiveRentalState(rental: { status: string; endDate: string } | null | undefined): AccessState {
  if (!rental) return 'NONE';
  if (rental.status === 'PENDING') return 'PENDING';
  if (rental.status === 'CANCELLED') return 'CANCELLED';
  if (rental.status === 'EXPIRED') return 'EXPIRED';
  if (rental.status === 'ACTIVE') return new Date(rental.endDate).getTime() > Date.now() ? 'ACTIVE' : 'EXPIRED';
  return 'NONE';
}

export interface SubscriptionOverview {
  state: AccessState;
  /** The term that is granting access right now, if any. */
  current: SellerSubscription | null;
  /** A renewal / upgrade / paid request waiting for payment confirmation. */
  pending: SellerSubscription | null;
  /** An approved upgrade queued behind the current plan: it starts by itself when that plan ends. */
  scheduled: SellerSubscription | null;
  /** The subscription the card should describe (current → pending → most recent). */
  shown: SellerSubscription | null;
  /** The most recent expired/active term — the base a renewal is created from (null if none). */
  lastTerm: SellerSubscription | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function deriveSubscriptionState(
  current: SellerSubscription | null,
  pending: SellerSubscription | null,
  history: SellerSubscription[],
): { state: AccessState; shown: SellerSubscription | null; lastTerm: SellerSubscription | null } {
  const lastTerm = history.find((s) => s.status === 'EXPIRED' || (s.status === 'ACTIVE' && !s.isScheduled)) ?? null;
  if (current) return { state: 'ACTIVE', shown: current, lastTerm: current };
  if (pending) return { state: 'PENDING', shown: pending, lastTerm };
  const latest = history[0] ?? null;
  if (!latest) return { state: 'NONE', shown: null, lastTerm: null };
  if (latest.status === 'CANCELLED') return { state: 'CANCELLED', shown: latest, lastTerm };
  return { state: 'EXPIRED', shown: latest, lastTerm };
}

/** Subscription overview for a scope; refreshes on window focus and every 30 s while visible. */
export function useSubscriptionOverview(scope: PackageScope, enabled = true): SubscriptionOverview {
  const [current, setCurrent] = useState<SellerSubscription | null>(null);
  const [pending, setPending] = useState<SellerSubscription | null>(null);
  const [scheduled, setScheduled] = useState<SellerSubscription | null>(null);
  const [history, setHistory] = useState<SellerSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const [cur, hist] = await Promise.all([
        api.get(`/packages/my-subscription?scope=${scope}`),
        api.get(`/packages/my-subscriptions?scope=${scope}&limit=10`).catch(() => ({ data: { subscriptions: [] } })),
      ]);
      if (!alive.current) return;
      setCurrent(cur.data.subscription ?? null);
      setPending(cur.data.pending ?? null);
      setScheduled(cur.data.scheduled ?? null);
      setHistory(hist.data.subscriptions ?? []);
    } catch {
      /* keep what we have */
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [scope, enabled]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => { alive.current = false; };
    refresh();
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh, enabled]);

  const derived = deriveSubscriptionState(current, pending, history);
  return { ...derived, current, pending, scheduled, loading, refresh };
}
