'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { getApiErrorMessage } from '@/lib/utils';
import ClearLogsButton from '@/components/admin/ClearLogsButton';
import { ExpandableGroup, LogPagination, Meta, Stat, formatDateTime, formatLocation } from '@/components/admin/LogGroup';

interface SearchGroup {
  /** Lower-cased, trimmed term; "" groups every filter-only search. */
  key: string;
  term: string | null;
  count: number;
  searchers: number;
  firstAt: string;
  lastAt: string;
}

interface SearchRow {
  id: string;
  context: string;
  resultCount: number | null;
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
  { value: 'lastAt', label: 'Latest' },
  { value: 'count', label: 'Most searched' },
  { value: 'term', label: 'Search term' },
] as const;

const inputCls = 'min-w-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400';

/** Search context JSON as a short readable summary, e.g. "category=electronics, priceMax=500". */
function formatContext(contextJson: string): string {
  try {
    const parsed = JSON.parse(contextJson) as Record<string, unknown>;
    const parts = Object.entries(parsed)
      .filter(([key, value]) => value !== undefined && value !== null && value !== '' && key !== 'q')
      .map(([key, value]) => `${key}=${value}`);
    return parts.length ? parts.join(', ') : '—';
  } catch {
    return contextJson;
  }
}

export default function AdminSearchLogsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<(typeof SORTS)[number]['value']>('lastAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const limit = 25;
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      setFetching(true);
      setError('');
      const params: Record<string, string | number> = { page, limit, sortBy, sortDir };
      if (search) params.search = search;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await api.get('/admin/logs/searches/grouped', { params });
      setGroups(data.groups);
      setTotalGroups(data.pagination.total);
      setTotalRows(data.totalRows);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load search logs.'));
    } finally {
      setFetching(false);
    }
  }, [page, sortBy, sortDir, search, dateFrom, dateTo]);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void fetchGroups(); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [user, fetchGroups, reloadKey]);

  useEffect(() => { setPage(1); }, [search, dateFrom, dateTo, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(totalGroups / limit));
  const filterSig = `${dateFrom}|${dateTo}|${reloadKey}`;

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-bold text-gray-900">Search Logs</h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
            Every search on the site, with repeats of the same term combined. Open a row to see each time it was searched and by whom.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Stat value={totalGroups} label="Terms" />
          <Stat value={totalRows} label="Searches" />
          <ClearLogsButton scope="SEARCH_LOGS" onCleared={() => { setPage(1); setReloadKey((k) => k + 1); }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search term, email, phone, IP or country…"
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
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm">
        {fetching ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No search logs found.</p>
        ) : (
          groups.map((g) => (
            <ExpandableGroup<SearchRow>
              key={`${g.key}|${filterSig}`}
              count={g.count}
              countLabel="searches"
              header={
                g.key === ''
                  ? <span className="truncate font-normal italic text-gray-500">Filter-only searches (no term)</span>
                  : <span className="truncate" title={g.term ?? g.key}>{g.term?.trim() || g.key}</span>
              }
              meta={
                <>
                  <Meta>{g.searchers} searcher{g.searchers === 1 ? '' : 's'}</Meta>
                  <Meta>since {formatDateTime(g.firstAt)}</Meta>
                </>
              }
              trailing={<><div>Latest</div><div className="font-medium text-gray-700">{formatDateTime(g.lastAt)}</div></>}
              loadRows={async () => {
                const params: Record<string, string> = { key: g.key };
                if (dateFrom) params.dateFrom = dateFrom;
                if (dateTo) params.dateTo = dateTo;
                const { data } = await api.get('/admin/logs/searches/group', { params });
                return data.rows as SearchRow[];
              }}
              rowKey={(r) => r.id}
              renderRow={(r) => (
                <>
                  <span className="whitespace-nowrap font-medium text-gray-800">{formatDateTime(r.createdAt)}</span>
                  {g.key === '' && <span className="min-w-0 max-w-full truncate" title={formatContext(r.context)}>{formatContext(r.context)}</span>}
                  {g.key !== '' && formatContext(r.context) !== '—' && <span className="min-w-0 max-w-full truncate text-gray-500" title={formatContext(r.context)}>{formatContext(r.context)}</span>}
                  <span>{r.resultCount ?? '—'} results</span>
                  <span className="min-w-0 max-w-full truncate">{r.userEmail ?? <span className="text-gray-400">Guest</span>}</span>
                  {r.userPhone && <span className="whitespace-nowrap">{r.userPhone}</span>}
                  <span className="whitespace-nowrap text-gray-500">{formatLocation(r)}</span>
                  <span className="whitespace-nowrap font-mono text-[11px] text-gray-400">{r.ip ?? '—'}</span>
                </>
              )}
            />
          ))
        )}
      </div>

      <LogPagination page={page} totalPages={totalPages} total={totalGroups} noun="terms" onPage={setPage} />
    </div>
  );
}
