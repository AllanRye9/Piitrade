'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SupportRequest {
  id: string;
  question: string;
  status: 'OPEN' | 'RESOLVED';
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  adminResponse: string | null;
  transcript: { role: 'user' | 'assistant'; text: string }[] | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string; role: string } | null;
}

export default function AdminSupportRequestsPage() {
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [filter, setFilter] = useState<'OPEN' | 'RESOLVED' | 'ALL'>('OPEN');
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/support/admin/requests', { params: filter === 'ALL' ? {} : { status: filter } })
      .then(({ data }) => { setRequests(data.requests ?? []); setOpenCount(data.openCount ?? 0); })
      .catch(() => setError('Failed to load support requests'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const act = async (r: SupportRequest, status?: 'OPEN' | 'RESOLVED') => {
    setBusyId(r.id);
    setError('');
    try {
      const response = drafts[r.id]?.trim();
      await api.patch(`/support/admin/requests/${r.id}`, { ...(status && { status }), ...(response && { response }) });
      setDrafts((d) => ({ ...d, [r.id]: '' }));
      load();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Support Requests</h1>
          <p className="text-sm text-gray-500">Shoppers the AI assistant could not help and who asked for a person. {openCount} open.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          {(['OPEN', 'RESOLVED', 'ALL'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg font-medium ${filter === f ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
              {f === 'OPEN' ? 'Open' : f === 'RESOLVED' ? 'Resolved' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && requests.length === 0 && <p className="text-sm text-gray-500">Nothing here.</p>}

      {requests.map((r) => (
        <div key={r.id} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 break-words">{r.question}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(r.createdAt).toLocaleString()} ·{' '}
                {r.user
                  ? `${r.user.name || r.user.email} (${r.user.role.toLowerCase()}) — ${r.user.email}`
                  : `Guest${r.contactName ? ` ${r.contactName}` : ''} — ${r.contactEmail || r.contactPhone || 'no contact'}`}
              </p>
            </div>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold ${r.status === 'OPEN' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
              {r.status === 'OPEN' ? 'Open' : 'Resolved'}
            </span>
          </div>

          {r.transcript && r.transcript.length > 0 && (
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer font-medium text-gray-700">Conversation ({r.transcript.length})</summary>
              <ul className="mt-2 space-y-1">
                {r.transcript.map((t, i) => (
                  <li key={i}><span className="font-semibold">{t.role === 'user' ? 'Shopper' : 'Assistant'}:</span> {t.text}</li>
                ))}
              </ul>
            </details>
          )}

          {r.adminResponse && (
            <p className="text-xs rounded-lg bg-gray-50 border border-gray-100 p-2 text-gray-700"><span className="font-semibold">Last reply:</span> {r.adminResponse}</p>
          )}

          <textarea
            value={drafts[r.id] ?? ''}
            onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
            rows={2}
            maxLength={2000}
            placeholder={r.user ? 'Reply (sent to the user\'s notifications)…' : 'Note (guest — contact them using the details above)…'}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <div className="flex gap-2 justify-end">
            <button disabled={busyId === r.id || !(drafts[r.id] ?? '').trim()} onClick={() => act(r)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium disabled:opacity-40">Send reply</button>
            {r.status === 'OPEN' ? (
              <button disabled={busyId === r.id} onClick={() => act(r, 'RESOLVED')}
                className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold disabled:opacity-40">
                {(drafts[r.id] ?? '').trim() ? 'Reply & resolve' : 'Mark resolved'}
              </button>
            ) : (
              <button disabled={busyId === r.id} onClick={() => act(r, 'OPEN')}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium disabled:opacity-40">Reopen</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
