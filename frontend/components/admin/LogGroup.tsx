'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '@/lib/utils';
import { reconcile } from '@/lib/reconcile';

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

/**
 * Loads a group's detail rows the first time it is opened, and again (quietly, without a spinner) whenever
 * `version` changes while it is open, so an expanded group never shows stale entries.
 */
export function useGroupRows<Row>(loadRows: () => Promise<Row[]>, version?: string | number) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadRef = useRef(loadRows);
  useEffect(() => { loadRef.current = loadRows; });

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const next = await loadRef.current();
      setRows((prev) => (prev ? reconcile(prev, next) : next));
      setError('');
    } catch (err) {
      if (!quiet) setError(getApiErrorMessage(err, 'Failed to load entries.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { if (open && rows === null && !loading) void load(); }, [open, rows, loading, load]);

  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    if (open && rows !== null) void load(true);
  }, [version, open, rows, load]);

  return { open, setOpen, rows, loading, error, load };
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
  version,
}: {
  header: React.ReactNode;
  meta?: React.ReactNode;
  count: number;
  countLabel?: string;
  trailing?: React.ReactNode;
  loadRows: () => Promise<Row[]>;
  renderRow: (row: Row) => React.ReactNode;
  rowKey: (row: Row) => string;
  /** Changes whenever the group's data changed (e.g. its click count): an open group then reloads its rows quietly. */
  version?: string | number;
}) {
  const { open, setOpen, rows, loading, error, load } = useGroupRows<Row>(loadRows, version);

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
              <button type="button" onClick={() => void load(false)} className="underline">Retry</button>
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

/**
 * Card-view counterpart of ExpandableGroup: one card per group (photo on top, count badge over it), with the
 * same "open to see every entry" behaviour. Used by Item Clicks.
 */
export function GroupCard<Row>({
  image,
  title,
  badges,
  meta,
  count,
  countLabel,
  loadRows,
  renderRow,
  rowKey,
  version,
  href,
}: {
  image: React.ReactNode;
  title: string;
  badges?: React.ReactNode;
  meta?: React.ReactNode;
  count: number;
  countLabel?: string;
  loadRows: () => Promise<Row[]>;
  renderRow: (row: Row) => React.ReactNode;
  rowKey: (row: Row) => string;
  version?: string | number;
  /** Optional link to the underlying item (absent for deleted items). */
  href?: string | null;
}) {
  const { open, setOpen, rows, loading, error, load } = useGroupRows<Row>(loadRows, version);
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="relative aspect-[4/3] w-full bg-gray-100">
        {image}
        <div className="absolute right-2 top-2"><CountBadge count={count} label={countLabel} /></div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex min-w-0 items-start gap-1.5">
          <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-gray-900" title={title}>{title}</h3>
          {badges}
        </div>
        {meta && <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">{meta}</div>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            {open ? 'Hide clicks' : 'View clicks'}
          </button>
          {href && <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-red-600 hover:underline">Open item ↗</a>}
        </div>
      </div>
      {open && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-3 pb-2 pt-1">
          {loading && rows === null ? (
            <p className="py-2 text-xs text-gray-400">Loading…</p>
          ) : error ? (
            <p className="py-2 text-xs text-red-600">{error}{' '}<button type="button" onClick={() => void load(false)} className="underline">Retry</button></p>
          ) : rows && rows.length === 0 ? (
            <p className="py-2 text-xs text-gray-400">No entries.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto text-xs text-gray-700">
              {rows?.map((r) => (
                <li key={rowKey(r)} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">{renderRow(r)}</li>
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
