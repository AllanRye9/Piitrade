'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAdminAlerts, type AlertQueue, type AlertSeverity } from '@/context/AdminAlertsContext';

const SEV_STYLE: Record<AlertSeverity, { chip: string; ring: string; card: string; dot: string }> = {
  none: { chip: 'bg-slate-500 text-white', ring: '', card: 'border-gray-200 bg-white', dot: 'bg-slate-400' },
  info: { chip: 'bg-sky-500 text-white', ring: '', card: 'border-sky-200 bg-sky-50/60', dot: 'bg-sky-500' },
  warning: { chip: 'bg-amber-500 text-white', ring: 'animate-ring-amber', card: 'border-amber-300 bg-amber-50', dot: 'bg-amber-500' },
  critical: { chip: 'bg-red-600 text-white', ring: 'animate-ring-red', card: 'border-red-300 bg-red-50', dot: 'bg-red-500' },
};

export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Counter chip shown on a sidebar item. Pulses for warning/critical queues. */
export function NavAlertBadge({ href, dot = false }: { href: string; dot?: boolean }) {
  const { byHref } = useAdminAlerts();
  const a = byHref[href];
  if (!a) return null;
  const s = SEV_STYLE[a.severity];
  const label = a.count > 99 ? '99+' : String(a.count);
  if (dot) {
    return (
      <span className={`absolute right-0.5 top-0.5 flex h-2.5 w-2.5 rounded-full ${s.dot} ${a.pulse ? s.ring : ''}`} aria-label={`${a.count} pending`} />
    );
  }
  return (
    <span
      key={a.count /* re-mounts → plays the pop animation whenever the count changes */}
      className={`ml-auto inline-flex min-w-[1.25rem] animate-pop items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${s.chip} ${a.pulse ? s.ring : ''}`}
      aria-label={`${a.count} pending`}
    >
      {label}
    </span>
  );
}

/** Bell in the top bar: total pending, wiggles on new work, opens a quick list. */
export function AdminAlertBell() {
  const { alerts, available, flashing, markSeen } = useAdminAlerts();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!available || !alerts) return null;
  const { pending, severity, overdueQueues } = alerts.totals;
  const active = alerts.queues.filter((q) => q.count > 0);
  const s = SEV_STYLE[severity];

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${pending} pending tasks`}
        className={`relative flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-base hover:bg-gray-50 ${flashing.size ? 'animate-wiggle' : ''}`}
      >
        <span aria-hidden>🔔</span>
        {pending > 0 && (
          <span key={pending} className={`absolute -right-1 -top-1 flex min-w-[1.1rem] animate-pop items-center justify-center rounded-full px-1 text-[10px] font-bold leading-4 ${s.chip} ${severity === 'critical' || severity === 'warning' ? s.ring : ''}`}>
            {pending > 99 ? '99+' : pending}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] animate-scale-in overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-sm font-bold text-gray-900">Needs your attention</p>
            {alerts.totals.newSince > 0 && (
              <button type="button" onClick={markSeen} className="text-[11px] font-semibold text-red-600 hover:underline">Mark {alerts.totals.newSince} new as seen</button>
            )}
          </div>
          {active.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-emerald-700">✓ All caught up</p>
          ) : (
            <ul className="max-h-80 divide-y divide-gray-50 overflow-y-auto">
              {active.map((q) => (
                <li key={q.key}>
                  <Link href={q.href} onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_STYLE[q.severity].dot} ${q.pulse ? 'animate-pulse' : ''}`} />
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{q.label}</span>
                    {q.newSince > 0 && <span className="rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-700">+{q.newSince}</span>}
                    {q.overdue && <span className="rounded-full bg-red-600 px-1.5 text-[9px] font-bold text-white">OVERDUE</span>}
                    <span className="text-sm font-bold tabular-nums text-gray-900">{q.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {overdueQueues > 0 && <p className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700">{overdueQueues} queue{overdueQueues === 1 ? '' : 's'} waiting more than 24 h</p>}
        </div>
      )}
    </div>
  );
}

/** Bottom-right toasts when a queue grows while the admin is working. */
export function AdminAlertToasts() {
  const { toasts, dismissToast } = useAdminAlerts();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto animate-fade-up overflow-hidden rounded-xl border border-red-200 bg-white shadow-lg">
          <div className="flex items-start gap-2.5 p-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-xs animate-wiggle">🔔</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900">+{t.delta} new · {t.label}</p>
              <p className="text-xs text-gray-500">{t.count} waiting in total</p>
              <Link href={t.href} onClick={() => dismissToast(t.id)} className="mt-1 inline-block text-xs font-bold text-red-600 hover:underline">Review now →</Link>
            </div>
            <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <div className="h-0.5 origin-left animate-[shrink_9s_linear_forwards] bg-red-400" />
        </div>
      ))}
    </div>
  );
}

const QUEUE_ICON: Record<string, string> = {
  listings: '📋', images: '🖼️', kyc: '🪪', storeRentals: '🏪', renewals: '🔁',
  subscriptions: '💳', reports: '🚩', reviews: '⭐', support: '🛟',
};

function QueueCard({ q, flash }: { q: AlertQueue; flash: boolean }) {
  const s = SEV_STYLE[q.severity];
  return (
    <Link
      href={q.href}
      className={`group relative flex flex-col gap-1 rounded-xl border p-3 transition-all hover:-translate-y-0.5 hover:shadow-md ${s.card} ${q.pulse ? s.ring : ''} ${flash ? 'ring-2 ring-red-400' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xl leading-none" aria-hidden>{QUEUE_ICON[q.key] ?? '📌'}</span>
        <span key={q.count} className="animate-pop text-2xl font-black leading-none tabular-nums text-gray-900">{q.count}</span>
      </div>
      <p className="text-xs font-semibold leading-snug text-gray-800">{q.label}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
        {q.newSince > 0 && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white animate-pulse">+{q.newSince} new</span>}
        {q.overdue && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">OVERDUE</span>}
        {q.oldestAt && <span className="text-[10px] text-gray-500">oldest {ago(q.oldestAt)}</span>}
      </div>
      <span className="absolute bottom-2 right-2 text-xs text-gray-300 transition-colors group-hover:text-red-500" aria-hidden>→</span>
    </Link>
  );
}

/** Dashboard "Needs attention" panel. Hidden entirely if the API has no /admin/alerts. */
export function NeedsAttentionPanel() {
  const { alerts, available, flashing, markSeen, refresh } = useAdminAlerts();
  if (!available || !alerts) return null;
  const active = alerts.queues.filter((q) => q.count > 0).sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.count - a.count);
  const { pending, newSince, overdueQueues, severity } = alerts.totals;
  const watch = alerts.watch;
  const hasWatch = watch.expiringStoreRentals7d > 0 || watch.expiringSubscriptions3d > 0;

  const head =
    pending === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : severity === 'critical' ? 'border-red-300 bg-red-50 text-red-800'
    : 'border-amber-300 bg-amber-50 text-amber-900';

  return (
    <section aria-label="Pending tasks" className="space-y-2">
      <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${head} ${severity === 'critical' ? 'animate-ring-red' : ''}`}>
        <span className={`text-lg ${pending > 0 ? 'animate-wiggle' : ''}`} aria-hidden>{pending === 0 ? '✅' : severity === 'critical' ? '🚨' : '🔔'}</span>
        <p className="text-sm font-bold">
          {pending === 0 ? 'All caught up — nothing is waiting for you.' : `${pending} task${pending === 1 ? '' : 's'} waiting${overdueQueues ? ` · ${overdueQueues} overdue` : ''}`}
        </p>
        {newSince > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white animate-pulse">{newSince} new since you arrived</span>}
        <span className="ml-auto flex items-center gap-2 text-[11px]">
          {newSince > 0 && <button type="button" onClick={markSeen} className="font-semibold underline underline-offset-2">Mark seen</button>}
          <button type="button" onClick={() => refresh()} className="font-semibold underline underline-offset-2" title="Check now">↻ Refresh</button>
        </span>
      </div>

      {active.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {active.map((q) => <QueueCard key={q.key} q={q} flash={flashing.has(q.key)} />)}
        </div>
      )}

      {(hasWatch || alerts.activity.length > 0) && (
        <div className="grid gap-2 lg:grid-cols-3">
          {hasWatch && (
            <div className="rounded-xl border border-amber-200 bg-white p-3 lg:col-span-1">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">⏰ Expiring soon</p>
              <ul className="space-y-1 text-sm text-gray-700">
                {watch.expiringStoreRentals7d > 0 && <li><Link href="/admin/store-rentals" className="hover:underline"><b>{watch.expiringStoreRentals7d}</b> web store{watch.expiringStoreRentals7d === 1 ? '' : 's'} end within 7 days</Link></li>}
                {watch.expiringSubscriptions3d > 0 && <li><Link href="/admin/subscriptions" className="hover:underline"><b>{watch.expiringSubscriptions3d}</b> subscription{watch.expiringSubscriptions3d === 1 ? '' : 's'} end within 3 days</Link></li>}
              </ul>
            </div>
          )}
          {alerts.activity.length > 0 && (
            <div className={`rounded-xl border border-gray-200 bg-white p-3 ${hasWatch ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">Latest activity</p>
              <ul className="grid gap-x-4 sm:grid-cols-2">
                {alerts.activity.map((a) => (
                  <li key={`${a.type}-${a.id}`}>
                    <Link href={a.href} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-gray-50">
                      {a.isNew && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" aria-label="new" />}
                      <span className="rounded bg-gray-100 px-1 text-[10px] font-semibold uppercase text-gray-500">{a.type}</span>
                      <span className={`min-w-0 flex-1 truncate ${a.isNew ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{a.title}</span>
                      <span className="shrink-0 text-[10px] text-gray-400">{ago(a.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
