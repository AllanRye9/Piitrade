'use client';

/**
 * Web Store — Advanced Tools
 *
 * Professional store-management tools for users with an ACTIVE Web Store
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

// ── Messages (Customer Communication) Tab ────────────────────────────────────
function MessagesTab() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/messages/conversations');
      setConversations(data.conversations ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load messages.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openThread = async (counterpartId: string) => {
    setActiveId(counterpartId);
    setThreadLoading(true);
    try {
      const { data } = await api.get(`/messages/thread/${counterpartId}`);
      setThread(data.messages ?? []);
      setConversations((prev) => prev.map((c) => c.counterpart.id === counterpartId ? { ...c, unreadCount: 0 } : c));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load conversation.'));
    } finally {
      setThreadLoading(false);
    }
  };

  const sendReply = async () => {
    if (!activeId || !reply.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post('/messages', { receiverId: activeId, content: reply.trim() });
      setThread((prev) => [...prev, data.message]);
      setReply('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to send message.'));
    } finally {
      setSending(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading conversations…</p>;

  return (
    <div>
      {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
      {conversations.length === 0 ? (
        <p className="text-center py-10 text-sm text-gray-400">No customer messages yet.</p>
      ) : (
        <div className="grid sm:grid-cols-[220px_1fr] gap-4">
          <div className="space-y-1 max-h-[420px] overflow-y-auto">
            {conversations.map((c) => (
              <button key={c.counterpart.id} onClick={() => openThread(c.counterpart.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${
                  activeId === c.counterpart.id ? 'bg-red-50 text-red-700' : 'hover:bg-gray-50 text-gray-700'}`}>
                <span className="truncate">{c.counterpart.name}</span>
                {c.unreadCount > 0 && (
                  <span className="shrink-0 bg-red-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{c.unreadCount}</span>
                )}
              </button>
            ))}
          </div>
          <div className="border border-gray-100 rounded-xl p-3 min-h-[300px] flex flex-col">
            {!activeId ? (
              <p className="m-auto text-sm text-gray-400">Select a conversation</p>
            ) : threadLoading ? (
              <p className="m-auto text-sm text-gray-400">Loading…</p>
            ) : (
              <>
                <div className="flex-1 space-y-2 overflow-y-auto mb-3 max-h-[300px]">
                  {thread.map((m) => (
                    <div key={m.id} className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                      m.senderId === activeId ? 'bg-gray-100 text-gray-800' : 'bg-red-600 text-white ml-auto'}`}>
                      {m.content}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={reply} onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendReply(); }}
                    placeholder="Type a reply…" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <button onClick={sendReply} disabled={sending || !reply.trim()}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                    Send
                  </button>
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
        <h1 className="text-lg font-bold text-gray-900 mb-1">Advanced Tools require an active Web Store</h1>
        <p className="text-sm text-gray-500 mb-5">
          Inventory, order tracking, analytics, customer messaging, and promotions are available to
          users with an ACTIVE Web Store subscription.
        </p>
        <Link href="/dashboard/store-rental" className="inline-block px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl">
          Go to Web Store Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full px-2 sm:px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-xl font-extrabold text-gray-900">Web Store — Advanced Tools</h1>
          <p className="text-xs text-gray-500">Professional management tools for your store.</p>
        </div>
        <Link href="/dashboard/store-rental" className="whitespace-nowrap text-xs text-gray-500 underline hover:text-gray-800">
          ← Back to Dashboard
        </Link>
      </div>

      <div className="grid items-start gap-2 lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav aria-label="Store tools" className="flex gap-1 overflow-x-auto rounded-xl border border-gray-100 bg-white p-1.5 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:sticky lg:top-[calc(var(--sticky-offset,0px)+52px)] lg:flex-col lg:overflow-visible">
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
