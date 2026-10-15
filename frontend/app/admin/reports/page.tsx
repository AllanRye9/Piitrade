'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';

type Status = 'OPEN' | 'RESOLVED' | 'DISMISSED';
type Action = 'REMOVE_LISTING' | 'WARN_SELLER' | 'BAN_SELLER' | 'NO_ACTION';

interface Report {
  id: string;
  reason: string;
  createdAt: string;
  status: Status;
  resolution: string | null;
  adminNote: string | null;
  resolvedAt: string | null;
  listingReportCount: number;
  reporter: { id: string; name: string; email: string };
  listing: {
    id: string;
    title: string;
    status: string;
    user: { id: string; name: string; email: string; isBanned: boolean };
  };
}

const TABS: { key: Status; label: string }[] = [
  { key: 'OPEN', label: 'Open' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'DISMISSED', label: 'Dismissed' },
];

const ACTIONS: { key: Action; label: string; hint: string; tone: string }[] = [
  { key: 'REMOVE_LISTING', label: 'Remove listing', hint: 'Hides this listing and closes all open reports on it.', tone: 'bg-red-600 hover:bg-red-700 text-white' },
  { key: 'WARN_SELLER', label: 'Warn seller', hint: 'Notifies the seller; the listing stays live.', tone: 'bg-amber-500 hover:bg-amber-600 text-white' },
  { key: 'BAN_SELLER', label: 'Ban seller', hint: 'Suspends the seller and hides all their live listings.', tone: 'bg-gray-900 hover:bg-black text-white' },
  { key: 'NO_ACTION', label: 'No violation', hint: 'Closes the report as reviewed.', tone: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
];

const RESOLUTION_LABEL: Record<string, string> = {
  REMOVE_LISTING: 'Listing removed', WARN_SELLER: 'Seller warned', BAN_SELLER: 'Seller banned',
  NO_ACTION: 'No violation', DISMISSED: 'Dismissed',
};

export default function AdminReportsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Status>('OPEN');
  const [reports, setReports] = useState<Report[]>([]);
  const [counts, setCounts] = useState<Record<Status, number>>({ OPEN: 0, RESOLVED: 0, DISMISSED: 0 });
  const [fetching, setFetching] = useState(true);
  const [active, setActive] = useState<Report | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setFetching(true);
    setLoadError(false);
    api.get('/admin/reports', { params: { status: tab } })
      .then(({ data }) => { setReports(data.reports || []); if (data.counts) setCounts(data.counts); })
      // A failed load must not read as "No open reports" in a moderation queue.
      .catch(() => { setReports([]); setLoadError(true); })
      .finally(() => setFetching(false));
  }, [tab]);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
    if (user?.role === 'ADMIN') load();
  }, [user, loading, router, load]);

  const close = () => { setActive(null); setNote(''); setError(''); };

  const act = async (kind: Action | 'DISMISS') => {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      if (kind === 'DISMISS') await api.put(`/admin/reports/${active.id}/dismiss`, { note });
      else await api.put(`/admin/reports/${active.id}/resolve`, { action: kind, note });
      close();
      load();
    } catch (e) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not update the report.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="mt-1 text-sm text-gray-500">Review listing reports and take action. Every decision is recorded and the seller and reporter are notified.</p>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1 w-fit" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            {t.label} <span className="ml-1 text-xs text-gray-400">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {fetching ? (
        <div className="p-8 text-center text-gray-500">Loading...</div>
      ) : loadError ? (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-700">
          <p>Couldn&apos;t load reports.</p>
          <button type="button" onClick={load} className="mt-2 underline font-medium">Retry</button>
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-6 text-center">
          <p className="text-3xl mb-3">✅</p>
          <p className="text-gray-500">{tab === 'OPEN' ? 'No open reports.' : `No ${tab.toLowerCase()} reports.`}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Listing', 'Seller', 'Reporter', 'Reason', 'Date', tab === 'OPEN' ? 'Actions' : 'Outcome'].map((h) => (
                    <th key={h} className="text-left px-3 sm:px-5 py-3 font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {reports.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 sm:px-5 py-3">
                      <Link href={`/listings/${r.listing.id}`} className="font-medium text-gray-900 hover:text-red-600" target="_blank">{r.listing.title}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{r.listing.status}</span>
                        {r.listingReportCount > 1 && <span className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-600">{r.listingReportCount} reports</span>}
                      </div>
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-gray-700">
                      {r.listing.user.name}
                      {r.listing.user.isBanned && <span className="ml-1 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">BANNED</span>}
                      <div className="text-xs text-gray-400">{r.listing.user.email}</div>
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-gray-600">{r.reporter.name}<div className="text-xs text-gray-400">{r.reporter.email}</div></td>
                    <td className="px-3 sm:px-5 py-3 text-gray-600 max-w-[260px]"><p className="line-clamp-3">{r.reason}</p></td>
                    <td className="px-3 sm:px-5 py-3 text-gray-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-3 sm:px-5 py-3">
                      {r.status === 'OPEN' ? (
                        <button onClick={() => { setActive(r); setNote(''); setError(''); }}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">Review</button>
                      ) : (
                        <div className="text-xs text-gray-600">
                          <span className="font-semibold">{RESOLUTION_LABEL[r.resolution || ''] || r.status}</span>
                          {r.resolvedAt && <span className="text-gray-400"> · {formatDate(r.resolvedAt)}</span>}
                          {r.adminNote && <p className="mt-0.5 text-gray-500">“{r.adminNote}”</p>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close} role="presentation">
          <div role="dialog" aria-modal="true" aria-label="Review report" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Review report</h2>
            <p className="mt-1 text-sm text-gray-600"><strong>{active.listing.title}</strong> — by {active.listing.user.name}</p>
            <blockquote className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{active.reason}</blockquote>

            <label className="mt-4 block text-xs font-medium text-gray-700">Note (optional, included in the seller notice)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />

            {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2">
              {ACTIONS.map((a) => (
                <button key={a.key} disabled={busy} onClick={() => act(a.key)} title={a.hint}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${a.tone}`}>
                  {a.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button disabled={busy} onClick={() => act('DISMISS')} className="text-sm font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-50">
                Dismiss as invalid
              </button>
              <button onClick={close} className="text-sm text-gray-500 hover:text-gray-800">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
