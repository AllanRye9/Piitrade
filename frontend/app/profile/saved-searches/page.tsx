'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useTr } from '@/lib/i18n/useTr';
import { T } from '@/components/ui/T';
import { ListPageSkeleton } from '@/components/ui/PageSkeleton';
import { SavedSearchRow, toListingsHref } from '@/lib/savedSearch';

const CHIP_LABELS: Record<string, (v: string) => string> = {
  q: (v) => `“${v}”`,
  category: (v) => v.replace(/-/g, ' '),
  location: (v) => `📍 ${v}`,
  condition: (v) => (v === 'NEW' ? 'New' : 'Used'),
  priceMin: (v) => `≥ UGX ${Number(v).toLocaleString('en-UG')}`,
  priceMax: (v) => `≤ UGX ${Number(v).toLocaleString('en-UG')}`,
  verifiedOnly: () => '🛡️ Verified sellers',
  withPhotos: () => '📷 With photos',
};

export default function SavedSearchesPage() {
  const tr = useTr();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<SavedSearchRow[] | null>(null);
  const [max, setMax] = useState(10);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/saved-searches');
      setRows(data.searches ?? []);
      if (typeof data.max === 'number') setMax(data.max);
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) setUnavailable(true);
      setRows((r) => r ?? []);
    }
  }, []);

  useEffect(() => { if (user) load(); }, [user, load]);

  const toggle = async (row: SavedSearchRow) => {
    setRows((rs) => rs && rs.map((r) => (r.id === row.id ? { ...r, notify: !r.notify } : r)));
    try { await api.patch(`/saved-searches/${row.id}`, { notify: !row.notify }); } catch { load(); }
  };
  const remove = async (row: SavedSearchRow) => {
    setRows((rs) => rs && rs.filter((r) => r.id !== row.id));
    try { await api.delete(`/saved-searches/${row.id}`); } catch { load(); }
  };
  const open = async (row: SavedSearchRow) => {
    api.patch(`/saved-searches/${row.id}`, { seen: true }).catch(() => {});
    router.push(toListingsHref(row.params));
  };

  if (authLoading) return <ListPageSkeleton rows={3} />;
  if (!user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-gray-500"><T>Please</T> <Link href="/auth/login?redirect=/profile/saved-searches" className="text-red-600 underline"><T>log in</T></Link> <T>to see your saved searches.</T></p>
      </div>
    );
  }

  const totalNew = (rows ?? []).reduce((n, r) => n + (r.notify ? r.newCount : 0), 0);

  return (
    <div className="mx-auto max-w-3xl px-3 py-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">🔔 <T>Saved searches</T></h1>
          <p className="text-sm text-gray-500"><T>We check every few minutes and tell you when new listings match.</T></p>
        </div>
        {rows && rows.length > 0 && <p className="text-xs text-gray-400 tabular-nums">{rows.length} / {max}</p>}
      </div>

      {totalNew > 0 && (
        <p className="mb-3 animate-pop rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="status">
          {totalNew} {totalNew === 1 ? tr('new listing matches your searches') : tr('new listings match your searches')}
        </p>
      )}

      {rows === null ? (
        <ListPageSkeleton rows={3} />
      ) : unavailable ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><T>Saved searches are not available on this server yet.</T></p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <div className="mb-2 text-4xl">🔔</div>
          <p className="font-semibold text-gray-700"><T>No saved searches yet</T></p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500"><T>Filter or search on the listings page, then tap “Save search” to get alerts for new matches.</T></p>
          <Link href="/listings" className="mt-4 inline-flex h-10 items-center rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700"><T>Browse listings</T></Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <button type="button" onClick={() => open(r)} className="min-w-0 flex-1 text-left">
                  <p className="flex items-center gap-2 truncate font-semibold text-gray-900">
                    <span className="truncate">{r.name}</span>
                    {r.notify && r.newCount > 0 && (
                      <span className="shrink-0 animate-pop rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">{r.newCount} {tr('new')}</span>
                    )}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {Object.entries(r.params).map(([k, v]) => v && CHIP_LABELS[k] ? (
                      <span key={k} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] capitalize text-gray-600">{CHIP_LABELS[k](String(v))}</span>
                    ) : null)}
                  </div>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
                    <span>{tr('Alerts')}</span>
                    <button type="button" role="switch" aria-checked={r.notify} onClick={() => toggle(r)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${r.notify ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${r.notify ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </label>
                  <button type="button" onClick={() => remove(r)} className="text-xs text-gray-400 hover:text-red-600">{tr('Delete')}</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
