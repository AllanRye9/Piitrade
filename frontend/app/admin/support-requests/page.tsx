'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type Status = 'OPEN' | 'RESOLVED';
type Turn = { role: 'user' | 'assistant'; text: string };

interface SupportRequest {
  id: string;
  question: string;
  status: Status;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  adminResponse: string | null;
  transcript: Turn[] | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string; role: string } | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function whoOf(r: SupportRequest) {
  const name = r.user ? r.user.name || r.user.email : r.contactName || 'Guest';
  const contact = r.user ? r.user.email : r.contactEmail || r.contactPhone || 'No contact left';
  return { name, contact, isGuest: !r.user };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return (parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?');
}

function Bubbles({ turns }: { turns: Turn[] }) {
  return (
    <div className="space-y-2">
      {turns.map((t, i) => (
        <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
          <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug whitespace-pre-wrap break-words ${
            t.role === 'user' ? 'bg-gray-100 text-gray-800 rounded-bl-sm' : 'bg-gray-900 text-white rounded-br-sm'
          }`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${t.role === 'user' ? 'text-gray-400' : 'text-white/60'}`}>
              {t.role === 'user' ? 'Shopper' : 'AI assistant'}
            </p>
            {t.text}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminSupportRequestsPage() {
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [filter, setFilter] = useState<'OPEN' | 'RESOLVED' | 'ALL'>('OPEN');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [fullHistory, setFullHistory] = useState<Record<string, Turn[] | 'loading' | 'none'>>({});

  const load = useCallback(() => {
    setLoading(true);
    api.get('/support/admin/requests', { params: filter === 'ALL' ? {} : { status: filter } })
      .then(({ data }) => { setRequests(data.requests ?? []); setOpenCount(data.openCount ?? 0); setError(''); })
      .catch(() => setError('Failed to load support requests'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) => {
      const w = whoOf(r);
      return [r.question, w.name, w.contact].some((v) => v.toLowerCase().includes(q));
    });
  }, [requests, query]);

  const selected = requests.find((r) => r.id === selectedId) ?? null;

  const act = async (r: SupportRequest, status?: Status) => {
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

  const loadFullHistory = (userId: string) => {
    setFullHistory((h) => ({ ...h, [userId]: 'loading' }));
    api.get(`/support/admin/history/${userId}`)
      .then(({ data }) => setFullHistory((h) => ({ ...h, [userId]: data.messages?.length ? data.messages : 'none' })))
      .catch(() => setFullHistory((h) => ({ ...h, [userId]: 'none' })));
  };

  const draft = selected ? drafts[selected.id] ?? '' : '';

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 flex items-center gap-2">
            <span aria-hidden="true">🛟</span> Support Inbox
            {openCount > 0 && (
              <span className="text-xs font-bold bg-red-600 text-white rounded-full px-2 py-0.5">{openCount} open</span>
            )}
          </h1>
          <p className="text-sm text-gray-500">Shoppers the AI assistant couldn&apos;t help and who asked for a person.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          {(['OPEN', 'RESOLVED', 'ALL'] as const).map((f) => (
            <button key={f} onClick={() => { setFilter(f); setSelectedId(null); }}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${filter === f ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {f === 'OPEN' ? 'Open' : f === 'RESOLVED' ? 'Resolved' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid lg:grid-cols-[22rem_1fr] gap-4 items-start">
        {/* ── Conversation list ── */}
        <div className={`${selected ? 'hidden lg:block' : ''} rounded-2xl border border-gray-200 bg-white overflow-hidden`}>
          <div className="p-2.5 border-b border-gray-100">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, contact or question…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-100">
            {loading && <p className="p-4 text-sm text-gray-500">Loading…</p>}
            {!loading && visible.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-3xl mb-1" aria-hidden="true">{filter === 'OPEN' ? '🎉' : '📭'}</p>
                <p className="text-sm font-semibold text-gray-700">{filter === 'OPEN' && !query ? 'All caught up' : 'Nothing here'}</p>
                <p className="text-xs text-gray-500 mt-0.5">{filter === 'OPEN' && !query ? 'No shoppers are waiting for a reply.' : 'Try a different filter or search.'}</p>
              </div>
            )}
            {visible.map((r) => {
              const w = whoOf(r);
              const active = r.id === selectedId;
              return (
                <button key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left flex gap-3 px-3 py-3 transition-colors ${active ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                  <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${w.isGuest ? 'bg-gray-200 text-gray-600' : 'bg-gray-900 text-white'}`}>
                    {initials(w.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">{w.name}</span>
                      <span className="shrink-0 text-[11px] text-gray-400">{timeAgo(r.createdAt)}</span>
                    </span>
                    <span className="block text-xs text-gray-600 line-clamp-2 mt-0.5 break-words">{r.question}</span>
                    <span className="flex items-center gap-1.5 mt-1">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${r.status === 'OPEN' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {r.status === 'OPEN' ? 'Open' : 'Resolved'}
                      </span>
                      {w.isGuest && <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Guest</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Conversation detail ── */}
        {selected ? (() => {
          const w = whoOf(selected);
          const phone = selected.contactPhone?.trim();
          const email = selected.user?.email || selected.contactEmail;
          const hist = selected.user ? fullHistory[selected.user.id] : undefined;
          return (
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              {/* Contact header */}
              <div className="p-4 border-b border-gray-100 flex items-start gap-3">
                <button onClick={() => setSelectedId(null)} className="lg:hidden shrink-0 -ml-1 p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="Back to list">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                </button>
                <span className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold ${w.isGuest ? 'bg-gray-200 text-gray-600' : 'bg-gray-900 text-white'}`}>{initials(w.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-gray-900 truncate">{w.name}</p>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${selected.status === 'OPEN' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                      {selected.status === 'OPEN' ? 'Open' : 'Resolved'}
                    </span>
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                      {selected.user ? selected.user.role.toLowerCase() : 'guest'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{new Date(selected.createdAt).toLocaleString()} · {timeAgo(selected.createdAt)}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {email && <a href={`mailto:${email}`} className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">✉️ {email}</a>}
                    {phone && <a href={`tel:${phone}`} className="text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">📞 {phone}</a>}
                    {phone && <a href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium px-2.5 py-1 rounded-lg border border-green-200 text-green-700 hover:bg-green-50">WhatsApp</a>}
                    {!email && !phone && <span className="text-xs text-gray-400">No contact details left</span>}
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Question */}
                <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-0.5">Asked for a human</p>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">{selected.question}</p>
                </div>

                {/* Transcript */}
                {selected.transcript && selected.transcript.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Conversation ({selected.transcript.length})</p>
                    <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-100 p-3">
                      <Bubbles turns={selected.transcript} />
                    </div>
                  </div>
                )}

                {/* Full saved history (logged-in users) */}
                {selected.user && (
                  <div>
                    {hist === undefined ? (
                      <button onClick={() => loadFullHistory(selected.user!.id)} className="text-xs font-semibold text-red-600 hover:underline">
                        View this user&apos;s full saved chat history
                      </button>
                    ) : hist === 'loading' ? (
                      <p className="text-xs text-gray-500">Loading saved chat…</p>
                    ) : hist === 'none' ? (
                      <p className="text-xs text-gray-500">No saved chat history for this user.</p>
                    ) : (
                      <details open>
                        <summary className="text-xs font-bold uppercase tracking-wide text-gray-500 cursor-pointer mb-2">Full saved chat ({hist.length})</summary>
                        <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-100 p-3"><Bubbles turns={hist} /></div>
                      </details>
                    )}
                  </div>
                )}

                {selected.adminResponse && (
                  <div className="rounded-xl bg-green-50 border border-green-100 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-green-700 mb-0.5">Last reply sent</p>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{selected.adminResponse}</p>
                  </div>
                )}

                {/* Composer */}
                <div className="space-y-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [selected.id]: e.target.value }))}
                    rows={3}
                    maxLength={2000}
                    placeholder={selected.user ? "Reply — delivered to the user's notifications…" : 'Note (guest — contact them using the details above)…'}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] text-gray-400">{draft.length}/2000</span>
                    <div className="flex gap-2">
                      <button disabled={busyId === selected.id || !draft.trim()} onClick={() => act(selected)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-40">Send reply</button>
                      {selected.status === 'OPEN' ? (
                        <button disabled={busyId === selected.id} onClick={() => act(selected, 'RESOLVED')}
                          className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-40">
                          {draft.trim() ? 'Reply & resolve' : 'Mark resolved'}
                        </button>
                      ) : (
                        <button disabled={busyId === selected.id} onClick={() => act(selected, 'OPEN')}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-40">Reopen</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })() : (
          <div className="hidden lg:flex rounded-2xl border border-dashed border-gray-200 bg-white/60 min-h-[20rem] items-center justify-center text-center p-8">
            <div>
              <p className="text-4xl mb-2" aria-hidden="true">💬</p>
              <p className="text-sm font-semibold text-gray-700">Select a conversation</p>
              <p className="text-xs text-gray-500 mt-0.5">Pick a request on the left to read the chat and reply.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
