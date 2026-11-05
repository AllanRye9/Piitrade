'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { resolveImageUrl, getApiErrorMessage } from '@/lib/utils';
import ClearLogsButton from '@/components/admin/ClearLogsButton';
import { ExpandableGroup, GroupCard, LogPagination, Meta, Stat, formatDateTime, formatLocation } from '@/components/admin/LogGroup';
import { useLiveRefresh } from '@/lib/liveData';
import { reconcile } from '@/lib/reconcile';

interface ClickGroup {
  /** Listing id, or "title:<saved title>" for listings that have since been deleted. */
  key: string;
  listingId: string | null;
  title: string;
  image: string | null;
  /** Live listing status; null once the listing has been deleted. */
  status: string | null;
  count: number;
  visitors: number;
  firstAt: string;
  lastAt: string;
}

interface ClickRow {
  id: string;
  userEmail: string | null;
  userPhone: string | null;
  ip: string | null;
  ipCountry: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  createdAt: string;
}

const SORTS = [
  { value: 'count', label: 'Most clicked' },
  { value: 'lastAt', label: 'Latest click' },
  { value: 'title', label: 'Item title' },
] as const;

const inputCls = 'min-w-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400';

type ViewMode = 'list' | 'cards';
const VIEW_KEY = 'admin_click_logs_view';

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Pending approval', cls: 'bg-amber-50 text-amber-700' },
  REJECTED: { label: 'Rejected', cls: 'bg-red-50 text-red-700' },
  SOLD: { label: 'Sold', cls: 'bg-blue-50 text-blue-700' },
  EXPIRED: { label: 'Expired', cls: 'bg-gray-100 text-gray-600' },
  HIDDEN: { label: 'Hidden', cls: 'bg-gray-100 text-gray-600' },
};

/** Live status of the item. Active items need no badge; deleted ones are flagged. */
function StatusBadge({ g }: { g: ClickGroup }) {
  const b = !g.listingId ? { label: 'deleted', cls: 'bg-gray-100 text-gray-500' } : g.status ? STATUS_BADGES[g.status] : undefined;
  if (!b) return null;
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${b.cls}`}>{b.label}</span>;
}

/** Item photo that falls back to a neutral tile instead of a broken image. */
function ItemImage({ src, sizes, className }: { src: string | null; sizes: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) {
    return <span className="absolute inset-0 flex items-center justify-center text-gray-300" aria-hidden="true">📷</span>;
  }
  return <Image src={src} alt="" fill className={className ?? 'object-cover'} sizes={sizes} onError={() => setFailed(true)} />;
}

export default function AdminClickLogsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [groups, setGroups] = useState<ClickGroup[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<(typeof SORTS)[number]['value']>('count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<ViewMode>('list');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const requestSeq = useRef(0);
  const limit = 25;
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Restore the last-used view.
  useEffect(() => {
    try { const v = window.localStorage.getItem(VIEW_KEY); if (v === 'list' || v === 'cards') setView(v); } catch { /* storage unavailable */ }
  }, []);
  const chooseView = (v: ViewMode) => {
    setView(v);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };

  // `quiet` = background refresh: no loading state, no error flash, and the screen only changes if the data did.
  const fetchGroups = useCallback(async (quiet = false) => {
    const seq = ++requestSeq.current;
    try {
      if (!quiet) { setFetching(true); setError(''); }
      const params: Record<string, string | number> = { page, limit, sortBy, sortDir };
      if (search) params.search = search;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (includeDeleted) params.includeDeleted = 'true';
      const { data } = await api.get('/admin/logs/clicks/grouped', { params });
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      const total = data.pagination.total as number;
      // Items were removed and this page no longer exists: step back instead of showing an empty page.
      if (data.groups.length === 0 && page > 1) { setPage(Math.max(1, Math.ceil(total / limit))); return; }
      // reconcile(): unchanged data keeps its identity, so a refresh that found nothing new renders nothing.
      setGroups((prev) => reconcile(prev, data.groups as ClickGroup[]));
      setTotalGroups(total);
      setTotalRows(data.totalRows);
      setError('');
      setFetching(false);
    } catch (err) {
      if (!quiet) setError(getApiErrorMessage(err, 'Failed to load click logs.'));
    } finally {
      if (!quiet && seq === requestSeq.current) setFetching(false);
    }
  }, [page, sortBy, sortDir, search, dateFrom, dateTo, includeDeleted]);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void fetchGroups(); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [user, fetchGroups, reloadKey]);

  useEffect(() => { setPage(1); }, [search, dateFrom, dateTo, sortBy, sortDir, includeDeleted]);

  // Live data: the server pushes a note the moment a click is logged or an item is edited, approved,
  // rejected or deleted, and the list quietly re-reads (no spinner, no layout change, only what changed
  // re-renders). Falls back to polling if the live stream is unavailable.
  const { live } = useLiveRefresh(() => fetchGroups(true), { channel: 'admin', topic: 'clicks', enabled: user?.role === 'ADMIN' });

  const totalPages = Math.max(1, Math.ceil(totalGroups / limit));
  const filterSig = `${dateFrom}|${dateTo}|${reloadKey}`;

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            Item Clicks
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${live ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`} title={live ? 'Updates arrive instantly' : 'Live connection unavailable: refreshing every 20 seconds'}>
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-gray-400'}`} aria-hidden="true" />
              {live ? 'Live' : 'Auto'}
            </span>
          </h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
            Listing views, one row or card per item with its click count. Titles, photos and status are live; changes appear instantly. Open an item to see every click.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Stat value={totalGroups} label="Items" />
          <Stat value={totalRows} label="Clicks" />
          <ClearLogsButton scope="CLICK_LOGS" onCleared={() => { setPage(1); setReloadKey((k) => k + 1); }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Item title, email, phone, IP or country…"
          className={`${inputCls} col-span-2 sm:col-span-4 lg:min-w-[240px] lg:flex-1`}
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-500">From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${inputCls} flex-1`} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${inputCls} flex-1`} />
        </label>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className={inputCls} aria-label="Sort by">
          {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
        </select>
        <button type="button" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50" title="Toggle sort direction">
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
        {(dateFrom || dateTo) && (
          <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-red-600 hover:underline">Clear dates</button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} className="rounded border-gray-300 text-red-600 focus:ring-red-400" />
          Show deleted items
        </label>
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm" role="group" aria-label="View">
          {(['list', 'cards'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => chooseView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1.5 capitalize ${view === v ? 'bg-red-600 font-medium text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {v === 'list' ? 'List' : 'Cards'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {fetching ? (
        <p className="rounded-xl bg-white py-8 text-center text-sm text-gray-400 shadow-sm">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl bg-white py-8 text-center text-sm text-gray-400 shadow-sm">No click logs found.</p>
      ) : (
        <div className={view === 'cards' ? 'grid grid-cols-1 items-start gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm'}>
          {groups.map((g) => {
            const src = g.image ? resolveImageUrl(g.image) : null;
            const version = `${g.count}|${g.lastAt}`;
            const loadRows = async () => {
              const params: Record<string, string> = { key: g.key };
              if (dateFrom) params.dateFrom = dateFrom;
              if (dateTo) params.dateTo = dateTo;
              const { data } = await api.get('/admin/logs/clicks/group', { params });
              return data.rows as ClickRow[];
            };
            const renderRow = (r: ClickRow) => (
              <>
                <span className="whitespace-nowrap font-medium text-gray-800">{formatDateTime(r.createdAt)}</span>
                <span className="min-w-0 max-w-full truncate">{r.userEmail ?? <span className="text-gray-400">Guest</span>}</span>
                {r.userPhone && <span className="whitespace-nowrap">{r.userPhone}</span>}
                <span className="whitespace-nowrap text-gray-500">{formatLocation(r)}</span>
                <span className="whitespace-nowrap font-mono text-[11px] text-gray-400">{r.ip ?? '—'}</span>
              </>
            );
            const meta = (
              <>
                <Meta>{g.visitors} visitor{g.visitors === 1 ? '' : 's'}</Meta>
                <Meta>first {formatDateTime(g.firstAt)}</Meta>
              </>
            );
            if (view === 'cards') {
              return (
                <GroupCard<ClickRow>
                  key={`${g.key}|${filterSig}`}
                  image={<ItemImage src={src} sizes="(max-width: 480px) 100vw, (max-width: 1024px) 50vw, 25vw" />}
                  title={g.title}
                  badges={<StatusBadge g={g} />}
                  meta={<>{meta}<Meta>latest {formatDateTime(g.lastAt)}</Meta></>}
                  count={g.count}
                  countLabel="clicks"
                  href={g.listingId ? `/listings/${g.listingId}` : null}
                  version={version}
                  loadRows={loadRows}
                  rowKey={(r) => r.id}
                  renderRow={renderRow}
                />
              );
            }
            return (
              <ExpandableGroup<ClickRow>
                key={`${g.key}|${filterSig}`}
                count={g.count}
                countLabel="clicks"
                version={version}
                header={
                  <>
                    <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded bg-gray-100">
                      <ItemImage src={src} sizes="28px" />
                    </span>
                    <span className="truncate" title={g.title}>{g.title}</span>
                    <StatusBadge g={g} />
                  </>
                }
                meta={meta}
                trailing={<><div>Latest click</div><div className="font-medium text-gray-700">{formatDateTime(g.lastAt)}</div></>}
                loadRows={loadRows}
                rowKey={(r) => r.id}
                renderRow={renderRow}
              />
            );
          })}
        </div>
      )}

      <LogPagination page={page} totalPages={totalPages} total={totalGroups} noun="items" onPage={setPage} />
    </div>
  );
}
