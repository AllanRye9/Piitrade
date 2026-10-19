'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';

export type AlertSeverity = 'none' | 'info' | 'warning' | 'critical';

export interface AlertQueue {
  key: string;
  label: string;
  href: string;
  count: number;
  newSince: number;
  oldestAt: string | null;
  overdue: boolean;
  severity: AlertSeverity;
  pulse: boolean;
}

export interface AlertActivity {
  type: string;
  id: string;
  title: string;
  at: string;
  href: string;
  isNew: boolean;
}

export interface AdminAlerts {
  serverTime: string;
  since: string | null;
  totals: { pending: number; newSince: number; overdueQueues: number; severity: AlertSeverity };
  queues: AlertQueue[];
  watch: { expiringStoreRentals7d: number; expiringSubscriptions3d: number };
  activity: AlertActivity[];
}

export interface AlertToast {
  id: string;
  queueKey: string;
  label: string;
  href: string;
  delta: number;
  count: number;
}

interface Ctx {
  alerts: AdminAlerts | null;
  /** True once the endpoint has answered at least once (false on 404 → feature hidden). */
  available: boolean;
  loading: boolean;
  /** Queue keys whose count just went up — drives the short-lived "flash" animation. */
  flashing: Set<string>;
  /** Pending items per nav href (several queues can share one page). */
  byHref: Record<string, { count: number; severity: AlertSeverity; pulse: boolean; overdue: boolean }>;
  toasts: AlertToast[];
  dismissToast: (id: string) => void;
  /** Reset the "new since" baseline to now. */
  markSeen: () => void;
  refresh: () => Promise<void>;
}

const AdminAlertsContext = createContext<Ctx | null>(null);

const POLL_MS = 20_000;
const SEEN_KEY = 'adminAlertsSince';
const SEV_RANK: Record<AlertSeverity, number> = { none: 0, info: 1, warning: 2, critical: 3 };

function readSince(): string {
  try {
    const v = window.sessionStorage.getItem(SEEN_KEY);
    if (v) return v;
  } catch { /* ignore */ }
  const now = new Date().toISOString();
  try { window.sessionStorage.setItem(SEEN_KEY, now); } catch { /* ignore */ }
  return now;
}

export function AdminAlertsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<AdminAlerts | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const prev = useRef<Record<string, number> | null>(null);
  const sinceRef = useRef<string | null>(null);
  const missing = useRef(false);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    if (!enabled || missing.current) return;
    if (!sinceRef.current) sinceRef.current = readSince();
    try {
      const { data } = await api.get<AdminAlerts>('/admin/alerts', { params: { since: sinceRef.current, activity: 8 } });
      if (!data || !Array.isArray(data.queues)) return;
      setAlerts(data);
      setAvailable(true);

      const counts: Record<string, number> = {};
      for (const q of data.queues) counts[q.key] = q.count;
      if (prev.current) {
        const bumped: AlertQueue[] = data.queues.filter((q) => q.count > (prev.current![q.key] ?? 0));
        if (bumped.length) {
          setFlashing((f) => new Set([...f, ...bumped.map((q) => q.key)]));
          setToasts((t) => [
            ...t,
            ...bumped.map((q) => ({
              id: `${q.key}-${Date.now()}`,
              queueKey: q.key,
              label: q.label,
              href: q.href,
              delta: q.count - (prev.current![q.key] ?? 0),
              count: q.count,
            })),
          ].slice(-4));
          const keys = bumped.map((q) => q.key);
          window.setTimeout(() => setFlashing((f) => { const n = new Set(f); keys.forEach((k) => n.delete(k)); return n; }), 6000);
        }
      }
      prev.current = counts;
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      // Older API without /admin/alerts: quietly hide the feature instead of retrying forever.
      if (status === 404) missing.current = true;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = window.setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled, refresh]);

  // Toasts clear themselves after 9 s.
  useEffect(() => {
    if (!toasts.length) return;
    const id = window.setTimeout(() => setToasts((t) => t.slice(1)), 9000);
    return () => window.clearTimeout(id);
  }, [toasts]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    try { window.sessionStorage.setItem(SEEN_KEY, now); } catch { /* ignore */ }
    sinceRef.current = now;
    refresh();
  }, [refresh]);

  const byHref = useMemo(() => {
    const out: Ctx['byHref'] = {};
    for (const q of alerts?.queues ?? []) {
      if (!q.count) continue;
      const cur = out[q.href] ?? { count: 0, severity: 'none' as AlertSeverity, pulse: false, overdue: false };
      out[q.href] = {
        count: cur.count + q.count,
        severity: SEV_RANK[q.severity] > SEV_RANK[cur.severity] ? q.severity : cur.severity,
        pulse: cur.pulse || q.pulse,
        overdue: cur.overdue || q.overdue,
      };
    }
    return out;
  }, [alerts]);

  const value = useMemo<Ctx>(
    () => ({ alerts, available, loading, flashing, byHref, toasts, dismissToast, markSeen, refresh }),
    [alerts, available, loading, flashing, byHref, toasts, dismissToast, markSeen, refresh],
  );

  return <AdminAlertsContext.Provider value={value}>{children}</AdminAlertsContext.Provider>;
}

export function useAdminAlerts(): Ctx {
  const ctx = useContext(AdminAlertsContext);
  if (!ctx) {
    return {
      alerts: null, available: false, loading: false, flashing: new Set(), byHref: {}, toasts: [],
      dismissToast: () => undefined, markSeen: () => undefined, refresh: async () => undefined,
    };
  }
  return ctx;
}
