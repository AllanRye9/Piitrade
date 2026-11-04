'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { getApiErrorMessage } from '@/lib/utils';
import ClearLogsButton from '@/components/admin/ClearLogsButton';
import { ExpandableGroup, LogPagination, Meta, Stat, formatDateTime, formatDuration, formatTime } from '@/components/admin/LogGroup';

interface VisitorGroup {
  ip: string;
  days: number;
  devices: number;
  visits: number;
  durationSeconds: number;
  firstSeenAt: string;
  lastSeenAt: string;
  country: string | null;
  device: string | null;
}

interface VisitorRow {
  id: string;
  deviceId: string;
  dayKey: string;
  userAgent: string | null;
  device: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  durationSeconds: number;
  visitCount: number;
}

interface CountryBreakdownRow {
  country: string | null;
  count: number;
}

const DEVICE_CATEGORIES = ['Mobile', 'Desktop', 'Tablet', 'Unknown device'] as const;
const SORTS = [
  { value: 'lastSeenAt', label: 'Last seen' },
  { value: 'visits', label: 'Most visits' },
  { value: 'days', label: 'Most days' },
  { value: 'durationSeconds', label: 'Time on site' },
  { value: 'firstSeenAt', label: 'First seen' },
  { value: 'country', label: 'Country' },
  { value: 'device', label: 'Device' },
  { value: 'ip', label: 'IP address' },
] as const;

const inputCls = 'min-w-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400';

export default function AdminVisitorLogsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [groups, setGroups] = useState<VisitorGroup[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [uniqueDeviceCount, setUniqueDeviceCount] = useState(0);
  const [countryBreakdown, setCountryBreakdown] = useState<CountryBreakdownRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [deviceCategoryFilter, setDeviceCategoryFilter] = useState('');
  const [sortBy, setSortBy] = useState<(typeof SORTS)[number]['value']>('lastSeenAt');
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
      if (dateFilter) params.date = dateFilter;
      if (countryFilter) params.country = countryFilter;
      if (deviceCategoryFilter) params.deviceCategory = deviceCategoryFilter;
      const { data } = await api.get('/admin/logs/visitors/grouped', { params });
      setGroups(data.groups);
      setTotalGroups(data.pagination.total);
      setTotalRows(data.totalRows);
      setUniqueDeviceCount(data.uniqueDeviceCount);
      setCountryBreakdown(data.countryBreakdown || []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load visitor logs.'));
    } finally {
      setFetching(false);
    }
  }, [page, sortBy, sortDir, search, dateFilter, countryFilter, deviceCategoryFilter]);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void fetchGroups(); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [user, fetchGroups, reloadKey]);

  // Back to page 1 whenever a filter or sort changes (not on page itself).
  useEffect(() => { setPage(1); }, [search, dateFilter, countryFilter, deviceCategoryFilter, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(totalGroups / limit));
  const hasFilters = !!(dateFilter || countryFilter || deviceCategoryFilter);
  const filterSig = `${dateFilter}|${countryFilter}|${reloadKey}`;

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-xl font-bold text-gray-900">Visitor Logs</h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
            Proof-of-visit records grouped by IP address. Open a row to see each day, device and time on site.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Stat value={totalGroups} label="IPs" />
          <Stat value={totalRows} label="Log rows" />
          <Stat value={uniqueDeviceCount} label="Devices" />
          <ClearLogsButton scope="VISITOR_LOGS" onCleared={() => { setPage(1); setReloadKey((k) => k + 1); }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search IP, device ID, country or device…"
          className={`${inputCls} col-span-2 sm:col-span-3 lg:min-w-[240px] lg:flex-1`}
        />
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={inputCls} aria-label="Date" />
        <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} className={inputCls} aria-label="Country">
          <option value="">All countries</option>
          {countryBreakdown.map((row) => (
            <option key={row.country ?? 'unknown'} value={row.country ?? ''}>{row.country ?? 'Unknown'} ({row.count})</option>
          ))}
        </select>
        <select value={deviceCategoryFilter} onChange={(e) => setDeviceCategoryFilter(e.target.value)} className={inputCls} aria-label="Device type">
          <option value="">All devices</option>
          {DEVICE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className={inputCls} aria-label="Sort by">
          {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
        </select>
        <button type="button" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50" title="Toggle sort direction">
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
        {hasFilters && (
          <button type="button" onClick={() => { setDateFilter(''); setCountryFilter(''); setDeviceCategoryFilter(''); }} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50">
            Clear filters
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm">
        {fetching ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No visitor logs found.</p>
        ) : (
          groups.map((g) => (
            <ExpandableGroup<VisitorRow>
              key={`${g.ip}|${filterSig}`}
              count={g.visits}
              countLabel="visits"
              header={
                <>
                  <span className="truncate font-mono">{g.ip}</span>
                  {g.country && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-gray-600">
                      <FlagIcon code={g.country} size={14} />{g.country}
                    </span>
                  )}
                </>
              }
              meta={
                <>
                  <Meta>{g.device ?? 'Unknown device'}</Meta>
                  <Meta>{g.days} day{g.days === 1 ? '' : 's'}</Meta>
                  <Meta>{g.devices} device{g.devices === 1 ? '' : 's'}</Meta>
                  <Meta>{formatDuration(g.durationSeconds)} on site</Meta>
                </>
              }
              trailing={<><div>Last seen</div><div className="font-medium text-gray-700">{formatDateTime(g.lastSeenAt)}</div></>}
              loadRows={async () => {
                const params: Record<string, string> = { ip: g.ip };
                if (dateFilter) params.date = dateFilter;
                if (countryFilter) params.country = countryFilter;
                const { data } = await api.get('/admin/logs/visitors/group', { params });
                return data.rows as VisitorRow[];
              }}
              rowKey={(r) => r.id}
              renderRow={(r) => (
                <>
                  <span className="font-medium text-gray-800">{r.dayKey}</span>
                  <span>{formatTime(r.firstSeenAt)} – {formatTime(r.lastSeenAt)}</span>
                  <span title={r.userAgent ?? undefined}>{r.device ?? 'Unknown device'}</span>
                  <span>{formatDuration(r.durationSeconds)}</span>
                  <span>{r.visitCount} visit{r.visitCount === 1 ? '' : 's'}</span>
                  <span className="min-w-0 max-w-full truncate font-mono text-[11px] text-gray-400" title={r.deviceId}>{r.deviceId}</span>
                </>
              )}
            />
          ))
        )}
      </div>

      <LogPagination page={page} totalPages={totalPages} total={totalGroups} noun="IPs" onPage={setPage} />
    </div>
  );
}
