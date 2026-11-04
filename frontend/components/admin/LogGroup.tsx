'use client';

import { useCallback, useEffect, useState } from 'react';
import { getApiErrorMessage } from '@/lib/utils';

/**
 * Shared pieces for the admin log pages (Visitor Logs, Search Logs, Item Clicks).
 * Identical entries are collapsed into ONE row that shows how many times it appeared; opening the row
 * lists every occurrence. Nothing here scrolls sideways: rows truncate or wrap to the width they get.
 */

export function CountBadge({ count, label }: { count: number; label?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold tabular-nums text-red-700 ring-1 ring-red-100"
      title={`${count.toLocaleString()} ${label ?? 'times'}`}
    >
      ×{count.toLocaleString()}
      {label && <span className="hidden font-medium text-red-500 sm:inline">{label}</span>}
    </span>
  );
}

/** Small "label value" pair used in the meta line under a group title. */
export function Meta({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>;
}

export function ExpandableGroup<Row>({
  header,
  meta,
  count,
  countLabel,
  trailing,
  loadRows,
  renderRow,
  rowKey,
}: {
  header: React.ReactNode;
  meta?: React.ReactNode;
  count: number;
  countLabel?: string;
  trailing?: React.ReactNode;
  loadRows: () => Promise<Row[]>;
  renderRow: (row: Row) => React.ReactNode;
  rowKey: (row: Row) => string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await loadRows());
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load entries.'));
    } finally {
      setLoading(false);
    }
    // loadRows is a fresh closure every render; the parent re-keys the group when its filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (open && rows === null && !loading) void load(); }, [open, rows, loading, load]);

  return (
    <div className={open ? 'bg-gray-50/60' : undefined}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 sm:gap-3 sm:px-4"
      >
        <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-gray-900">{header}</div>
          {meta && <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0 text-[11px] text-gray-500">{meta}</div>}
        </div>
        <CountBadge count={count} label={countLabel} />
        {trailing && <div className="hidden shrink-0 text-right text-[11px] leading-tight text-gray-500 md:block">{trailing}</div>}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-3 pb-2 pt-1 sm:pl-11 sm:pr-4">
          {loading && rows === null ? (
            <p className="py-2 text-xs text-gray-400">Loading…</p>
          ) : error ? (
            <p className="py-2 text-xs text-red-600">
              {error}{' '}
              <button type="button" onClick={() => void load()} className="underline">Retry</button>
            </p>
          ) : rows && rows.length === 0 ? (
            <p className="py-2 text-xs text-gray-400">No entries.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-xs text-gray-700">
              {rows?.map((r) => (
                <li key={rowKey(r)} className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-0.5 py-1.5">{renderRow(r)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function LogPagination({ page, totalPages, total, noun, onPage }: { page: number; totalPages: number; total: number; noun: string; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-xs sm:text-sm">
      <span className="text-gray-500">Page {page} of {totalPages} ({total.toLocaleString()} {noun})</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Previous</button>
        <button type="button" onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

/** Compact stat used in the page header (number over small caption). */
export function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-base font-bold tabular-nums text-gray-900 sm:text-lg">{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
    </div>
  );
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function formatLocation(log: { latitude: number | null; longitude: number | null; locationAccuracy: number | null; ipCountry: string | null }): string {
  if (log.latitude !== null && log.longitude !== null) {
    const precision = log.locationAccuracy !== null ? ` ±${Math.round(log.locationAccuracy)}m` : '';
    return `${log.latitude.toFixed(3)}, ${log.longitude.toFixed(3)}${precision}`;
  }
  return log.ipCountry ?? '—';
}
