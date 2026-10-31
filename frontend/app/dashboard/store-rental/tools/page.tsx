'use client';

/**
 * Merchant — Advanced Tools
 *
 * Professional store-management tools for users with an ACTIVE Merchant
 * (StoreRental.status === 'ACTIVE'), gated the same way as the parent
 * /dashboard/store-rental page. Tabs:
 *  - Listings:   price + availability editing across the store's ads
 *  - Analytics:  views, active listings, enquiries, top listings
 *  - Messages:   enquiries from buyers (buyer <-> store owner threads)
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { resolveImageUrl, getApiErrorMessage, formatCurrency, formatDate } from '@/lib/utils';
import { Currency } from '@/lib/types';

type Tab = 'listings' | 'analytics' | 'messages';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'listings',  label: 'Listings',  icon: '📋' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
  { id: 'messages',  label: 'Enquiries', icon: '💬' },
];

// ── Shared types ──────────────────────────────────────────────────────────────
interface ListingRow {
  id: string;
  title: string;
  price: number;
  currency: Currency;
  status: string;
  views: number;
  images: string[];
  productImages?: { cdnUrl: string | null }[];
}

interface Analytics {
  totalViews: number;
  activeListings: number;
  totalConversations: number;
  soldListings: number;
  topListings: { id: string; title: string; views: number; price: number; currency: Currency; images: string[] }[];
}

interface Conversation {
  counterpart: { id: string; name: string; avatar: string | null };
  lastMessage: string;
  lastMessageAt: string;
  lastMessageFromMe?: boolean;
  listing: { id: string; title: string; images: string[] } | null;
  unreadCount: number;
}

interface Message {
  id: string;
  content: string;
  senderId: string;
  receiverId: string;
  read: boolean;
  createdAt: string;
}


function imgOf(l: { images: string[]; productImages?: { cdnUrl: string | null }[] }): string | null {
  return l.productImages?.[0]?.cdnUrl || l.images?.[0] || null;
}

// ── Listings Tab ───────────────────────────────────────────────────────────
function ListingsTab() {
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: string; price: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/listings', { params: { mine: 'true', limit: 100 } });
      const rows: ListingRow[] = data.listings ?? [];
      setListings(rows);
      const nextDrafts: typeof drafts = {};
      rows.forEach((l) => { nextDrafts[l.id] = { status: l.status, price: String(l.price) }; });
      setDrafts(nextDrafts);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load listings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveRow = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setError('');
    try {
      const { data } = await api.put(`/listings/${id}`, {
        price: Math.max(0, parseFloat(draft.price) || 0),
      });
      const current = listings.find((l) => l.id === id);
      if (current && draft.status !== current.status) {
        await api.patch(`/listings/${id}/status`, { status: draft.status });
      }
      setListings((prev) => prev.map((l) => l.id === id ? { ...l, ...data, status: draft.status } : l));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update listing.'));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading listings…</p>;

  return (
    <div>
      {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
      {listings.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          No listings yet. <Link href="/listings/create?store=1" className="text-red-600 underline">Post your first listing →</Link>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="fill-table w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2">Price</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => {
                const src = imgOf(l);
                const draft = drafts[l.id] ?? { status: l.status, price: '0' };
                return (
                  <tr key={l.id} className="border-b border-gray-50">
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2 min-w-[160px]">
                        <div className="relative w-9 h-9 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                          {src && <Image src={resolveImageUrl(src)} alt={l.title} fill className="object-cover" sizes="36px" />}
                        </div>
                        <span className="truncate max-w-[160px] font-medium text-gray-800" title={l.title}>{l.title}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <input value={draft.price} onChange={(e) => setDrafts((p) => ({ ...p, [l.id]: { ...p[l.id], price: e.target.value } }))}
                        className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm" inputMode="decimal" />
                    </td>
                    <td className="px-2 py-2">
                      <select value={draft.status} onChange={(e) => setDrafts((p) => ({ ...p, [l.id]: { ...p[l.id], status: e.target.value } }))}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs">
                        {['ACTIVE', 'SOLD', 'HIDDEN'].map((st) => <option key={st} value={st}>{st}</option>)}
                        {!['ACTIVE', 'SOLD', 'HIDDEN'].includes(l.status) && <option value={l.status}>{l.status}</option>}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <button onClick={() => saveRow(l.id)} disabled={savingId === l.id}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                        {savingId === l.id ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Analytics Tab ────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/stores/me/analytics')
      .then(({ data }) => setData(data))
      .catch((err) => setError(getApiErrorMessage(err, 'Failed to load analytics.')))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading analytics…</p>;
  if (error) return <p className="text-sm text-red-600 py-8 text-center">{error}</p>;
  if (!data) return null;

  const cards = [
    { label: 'Total Views', value: data.totalViews.toLocaleString() },
    { label: 'Active Listings', value: data.activeListings.toLocaleString() },
    { label: 'Sold', value: (data.soldListings ?? 0).toLocaleString() },
    { label: 'Enquiry threads', value: (data.totalConversations ?? 0).toLocaleString() },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
            <p className="text-lg font-bold text-gray-900 tabular-nums">{c.value}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Listings by Views</h3>
        {data.topListings.length === 0 ? (
          <p className="text-sm text-gray-400">No listings yet.</p>
        ) : (
          <div className="space-y-2">
            {data.topListings.map((l, i) => (
              <div key={l.id} className="flex items-center gap-3 border border-gray-100 rounded-xl p-2.5">
                <span className="text-xs font-bold text-gray-400 w-4 text-center shrink-0">{i + 1}</span>
                <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                  {l.images?.[0] && <Image src={resolveImageUrl(l.images[0])} alt={l.title} fill className="object-cover" sizes="40px" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate" title={l.title}>{l.title}</p>
                  <p className="text-xs text-gray-400">{formatCurrency(l.price, l.currency)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-900 tabular-nums">{l.views.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-400 uppercase">Views</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Enquiries (Customer Communication) Tab ───────────────────────────────────
// The API returns one conversation per (buyer, listing) pair, so a thread is identified by BOTH.
// Keying by buyer alone merged every listing a buyer asked about, highlighted several rows at
// once, cleared unread counts on the wrong rows and sent replies with no listing attached (so
// they vanished from the enquiry they answered).
const threadKey = (c: { counterpart: { id: string }; listing: { id: string } | null }) =>
  `${c.counterpart.id}:${c.listing?.id ?? 'none'}`;

function MessagesTab() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => threadKey(c) === activeKey) ?? null;

  const loadConversations = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // sellerOnly: only enquiries about THIS store's listings (not conversations where the owner is the buyer).
      const { data } = await api.get('/messages/conversations', { params: { sellerOnly: 'true', limit: 50 } });
      setConversations(data.conversations ?? []);
      if (!silent) setError('');
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, 'Failed to load enquiries.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const loadThread = useCallback(async (c: Conversation, silent = false) => {
    if (!silent) setThreadLoading(true);
    try {
      const { data } = await api.get(`/messages/thread/${c.counterpart.id}`, { params: { listing: c.listing?.id ?? 'none' } });
      setThread(data.messages ?? []);
      setConversations((prev) => prev.map((x) => (threadKey(x) === threadKey(c) ? { ...x, unreadCount: 0 } : x)));
    } catch (err) {
      if (!silent) setError(getApiErrorMessage(err, 'Failed to load the conversation.'));
    } finally {
      if (!silent) setThreadLoading(false);
    }
  }, []);

  const openThread = (c: Conversation) => {
    setError('');
    setActiveKey(threadKey(c));
    setThread([]);
    loadThread(c);
  };

  // New enquiries and replies arrive without a manual refresh.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadConversations(true);
      if (active) loadThread(active, true);
    }, 15000);
    return () => window.clearInterval(id);
  }, [loadConversations, loadThread, active]);

  useEffect(() => { bottomRef.current?.scrollIntoView?.({ block: 'end' }); }, [thread.length, activeKey]);

  const sendReply = async () => {
    if (!active || !reply.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const { data } = await api.post('/messages', {
        receiverId: active.counterpart.id,
        content: reply.trim(),
        // Keeps the reply inside the enquiry it answers.
        ...(active.listing ? { listingId: active.listing.id } : {}),
      });
      setThread((prev) => [...prev, data.message]);
      setConversations((prev) => prev.map((x) => (threadKey(x) === threadKey(active)
        ? { ...x, lastMessage: data.message.content, lastMessageAt: data.message.createdAt }
        : x)));
      setReply('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to send message.'));
    } finally {
      setSending(false);
    }
  };

  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [search, setSearch] = useState('');

  const unreadTotal = conversations.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0);
  const q = search.trim().toLowerCase();
  const visible = conversations.filter((c) =>
    (filter === 'all' || c.unreadCount > 0) &&
    (!q || c.counterpart.name.toLowerCase().includes(q) || (c.listing?.title ?? '').toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q)));

  const QUICK_REPLIES = ['Yes, it is still available.', 'Thank you for your interest. When would you like to view it?', 'The price is negotiable.'];

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex animate-pulse items-center gap-3 rounded-xl border border-gray-100 p-3">
            <div className="h-11 w-11 rounded-full bg-gray-100" />
            <div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-gray-100" /><div className="h-3 w-2/3 rounded bg-gray-100" /></div>
          </div>
        ))}
      </div>
    );
  }

  const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  const when = (iso: string) => {
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const Avatar = ({ c, size = 'h-11 w-11' }: { c: Conversation; size?: string }) => (
    c.counterpart.avatar
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={resolveImageUrl(c.counterpart.avatar)} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
      : <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-orange-400 text-sm font-bold text-white`}>{initials(c.counterpart.name)}</span>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-gray-900">Customer enquiries</h2>
          <p className="text-xs text-gray-500">
            {conversations.length === 0 ? 'Messages from buyers about your Merchant account’s listings appear here.'
              : unreadTotal > 0 ? `${unreadTotal} awaiting your reply · ${conversations.length} total` : `All caught up · ${conversations.length} total`}
          </p>
        </div>
        <button type="button" onClick={() => loadConversations()} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">↻ Refresh</button>
      </div>

      {error && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {conversations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center">
          <div className="mb-2 text-4xl" aria-hidden="true">💬</div>
          <p className="text-sm font-semibold text-gray-800">No enquiries yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">When a buyer messages you about one of your Merchant account’s listings it shows up here, and you can reply without leaving this page. Clear photos and a fair price bring more enquiries.</p>
          <Link href="/listings/create" className="mt-4 inline-block rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700">Post a listing</Link>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[300px_minmax(0,1fr)] md:items-stretch">
          {/* Inbox list — on phones it is hidden while a conversation is open */}
          <div className={`${active ? 'hidden md:flex' : 'flex'} min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white`}>
            <div className="space-y-2 border-b border-gray-100 p-2.5">
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search buyer, listing or message"
                aria-label="Search enquiries" className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm focus:border-red-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-100" />
              <div className="flex gap-1.5" role="tablist" aria-label="Filter enquiries">
                {([['all', `All (${conversations.length})`], ['unread', `Unread (${unreadTotal})`]] as const).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === id ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{label}</button>
                ))}
              </div>
            </div>
            <ul className="max-h-[520px] divide-y divide-gray-50 overflow-y-auto">
              {visible.length === 0 && <li className="px-4 py-8 text-center text-xs text-gray-400">No enquiries match.</li>}
              {visible.map((c) => {
                const key = threadKey(c);
                const unread = c.unreadCount > 0;
                const thumb = c.listing?.images?.[0];
                return (
                  <li key={key}>
                    <button type="button" onClick={() => openThread(c)} aria-current={activeKey === key ? 'true' : undefined}
                      className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors ${activeKey === key ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                      <Avatar c={c} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm ${unread ? 'font-extrabold text-gray-900' : 'font-semibold text-gray-800'}`}>{c.counterpart.name}</span>
                          <span className="shrink-0 text-[11px] text-gray-400">{when(c.lastMessageAt)}</span>
                        </span>
                        {c.listing && <span className="mt-0.5 block truncate text-[11px] font-medium text-red-600">Re: {c.listing.title}</span>}
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span className={`truncate text-xs ${unread ? 'font-semibold text-gray-800' : 'text-gray-500'}`}>{c.lastMessageFromMe ? 'You: ' : ''}{c.lastMessage}</span>
                          {unread && <span className="shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{c.unreadCount}</span>}
                        </span>
                      </span>
                      {thumb && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveImageUrl(thumb)} alt="" className="hidden h-10 w-10 shrink-0 rounded-md object-cover sm:block" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Conversation */}
          <div className={`${active ? 'flex' : 'hidden md:flex'} min-h-[420px] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white`}>
            {!active ? (
              <div className="m-auto px-6 text-center">
                <div className="mb-2 text-3xl" aria-hidden="true">👈</div>
                <p className="text-sm font-semibold text-gray-700">Select an enquiry</p>
                <p className="text-xs text-gray-400">Pick a conversation on the left to read and reply.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/70 px-3 py-2.5">
                  <button type="button" onClick={() => setActiveKey(null)} aria-label="Back to enquiries" className="rounded-lg px-2 py-1 text-lg text-gray-500 hover:bg-gray-100 md:hidden">‹</button>
                  <Avatar c={active} size="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-gray-900">{active.counterpart.name}</p>
                    {active.listing && <Link href={`/listings/${active.listing.id}`} className="block truncate text-xs text-red-600 hover:underline">About: {active.listing.title}</Link>}
                  </div>
                  <Link href={`/messages?with=${active.counterpart.id}&listing=${active.listing?.id ?? 'none'}`} className="hidden shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 sm:block">Open in Messages</Link>
                </div>
                {threadLoading ? (
                  <p className="m-auto text-sm text-gray-400">Loading…</p>
                ) : (
                  <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50/40 px-3 py-3 max-h-[360px]" aria-live="polite">
                    {thread.map((m) => {
                      const theirs = m.senderId === active.counterpart.id;
                      return (
                        <div key={m.id} className={`flex ${theirs ? 'justify-start' : 'justify-end'}`}>
                          <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${theirs ? 'rounded-bl-sm bg-white text-gray-800' : 'rounded-br-sm bg-red-600 text-white'}`}>
                            <p className="whitespace-pre-wrap break-words">{m.content}</p>
                            <p className={`mt-0.5 text-right text-[10px] ${theirs ? 'text-gray-400' : 'text-red-100'}`}>{clock(m.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                )}
                <div className="border-t border-gray-100 p-2.5">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {QUICK_REPLIES.map((t) => (
                      <button key={t} type="button" onClick={() => setReply(t)} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600 hover:border-red-300 hover:text-red-700">{t}</button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} aria-label="Reply"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendReply(); }}
                      placeholder="Type a reply…" className="h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100" />
                    <button type="button" onClick={sendReply} disabled={sending || !reply.trim()}
                      className="rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                      {sending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StoreAdvancedToolsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('listings');
  const [gateLoading, setGateLoading] = useState(true);
  const [hasActiveStore, setHasActiveStore] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth/login');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    api.get('/store-rentals/my')
      .then(({ data }) => setHasActiveStore(data.rental?.status === 'ACTIVE'))
      .catch(() => setHasActiveStore(false))
      .finally(() => setGateLoading(false));
  }, [user]);

  if (authLoading || gateLoading) return <div className="w-full px-3 py-10 text-center text-gray-400">Loading…</div>;

  if (!hasActiveStore) {
    return (
      <div className="max-w-lg mx-auto px-4 py-14 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <h1 className="text-lg font-bold text-gray-900 mb-1">Advanced Tools require an active Merchant account</h1>
        <p className="text-sm text-gray-500 mb-5">
          Inventory, order tracking, analytics, customer messaging, and promotions are available to
          users with an ACTIVE Merchant subscription.
        </p>
        <Link href="/dashboard/store-rental" className="inline-block px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl">
          Go to Merchant Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full px-2 sm:px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-xl font-extrabold text-gray-900">Merchant — Advanced Tools</h1>
          <p className="text-xs text-gray-500">Professional management tools for your Merchant account.</p>
        </div>
        <Link href="/dashboard/store-rental" className="whitespace-nowrap text-xs text-gray-500 underline hover:text-gray-800">
          ← Back to Dashboard
        </Link>
      </div>

      <div className="grid items-start gap-2 lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav aria-label="Merchant tools" className="flex gap-1 overflow-x-auto rounded-xl border border-gray-100 bg-white p-1.5 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:sticky lg:top-[calc(var(--sticky-offset,0px)+52px)] lg:flex-col lg:overflow-visible">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
                tab === t.id ? 'bg-red-50 text-red-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
              <span className="w-5 text-center">{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 rounded-xl border border-gray-100 bg-white p-3 shadow-sm sm:p-4">
          {tab === 'listings' && <ListingsTab />}
          {tab === 'analytics' && <AnalyticsTab />}
          {tab === 'messages' && <MessagesTab />}
        </div>
      </div>
    </div>
  );
}
