'use client';

/**
 * Web Store — Advanced Tools
 *
 * Professional store-management tools for users with an ACTIVE Web Store
 * (StoreRental.status === 'ACTIVE'), gated the same way as the parent
 * /dashboard/store-rental page. Tabs:
 *  - Inventory:  stock/SKU/price editing across the store's listings
 *  - Orders:     order tracking + status updates for orders placed on this store
 *  - Analytics:  views, active listings, order/revenue summary, top listings
 *  - Messages:   customer communication (buyer <-> store owner threads)
 *  - Promotions: coupon/discount setup scoped to this store
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { resolveImageUrl, getApiErrorMessage, formatCurrency, formatDate } from '@/lib/utils';
import { Currency } from '@/lib/types';

type Tab = 'inventory' | 'orders' | 'analytics' | 'messages' | 'promotions';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'inventory',  label: 'Inventory',  icon: '📦' },
  { id: 'orders',     label: 'Orders',     icon: '🚚' },
  { id: 'analytics',  label: 'Analytics',  icon: '📊' },
  { id: 'messages',   label: 'Customers',  icon: '💬' },
  { id: 'promotions', label: 'Promotions', icon: '🏷️' },
];

// ── Shared types ──────────────────────────────────────────────────────────────
interface ListingRow {
  id: string;
  title: string;
  price: number;
  currency: Currency;
  stock: number;
  sku: string | null;
  status: string;
  views: number;
  images: string[];
  productImages?: { cdnUrl: string | null }[];
}

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  currency: Currency;
  total: number;
  trackingNumber: string | null;
  createdAt: string;
  buyer: { id: string; name: string; email: string };
  items: { id: string; title: string; quantity: number; imageUrl: string | null }[];
}

interface Analytics {
  totalViews: number;
  activeListings: number;
  totalOrders: number;
  ordersByStatus: Record<string, number>;
  revenue: number;
  currency: Currency;
  topListings: { id: string; title: string; views: number; price: number; currency: Currency; stock: number; images: string[] }[];
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

interface Coupon {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  minOrderAmount: number | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  description: string | null;
}

const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

function imgOf(l: { images: string[]; productImages?: { cdnUrl: string | null }[] }): string | null {
  return l.productImages?.[0]?.cdnUrl || l.images?.[0] || null;
}

// ── Inventory Tab ───────────────────────────────────────────────────────────
function InventoryTab() {
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { stock: string; sku: string; price: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/listings', { params: { mine: 'true', limit: 100 } });
      const rows: ListingRow[] = data.listings ?? [];
      setListings(rows);
      const nextDrafts: typeof drafts = {};
      rows.forEach((l) => { nextDrafts[l.id] = { stock: String(l.stock), sku: l.sku ?? '', price: String(l.price) }; });
      setDrafts(nextDrafts);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load inventory.'));
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
        stock: Math.max(0, parseInt(draft.stock) || 0),
        sku: draft.sku.trim() || null,
        price: Math.max(0, parseFloat(draft.price) || 0),
      });
      setListings((prev) => prev.map((l) => l.id === id ? { ...l, ...data } : l));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update listing.'));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading inventory…</p>;

  return (
    <div>
      {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
      {listings.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          No listings yet. <Link href="/listings/create?store=1" className="text-red-600 underline">Post your first listing →</Link>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2">Price</th>
                <th className="px-2 py-2">Stock</th>
                <th className="px-2 py-2">SKU</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => {
                const src = imgOf(l);
                const draft = drafts[l.id] ?? { stock: '0', sku: '', price: '0' };
                const lowStock = parseInt(draft.stock) <= 2;
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
                      <input value={draft.stock} onChange={(e) => setDrafts((p) => ({ ...p, [l.id]: { ...p[l.id], stock: e.target.value } }))}
                        className={`w-16 border rounded-lg px-2 py-1 text-sm ${lowStock ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200'}`} inputMode="numeric" />
                    </td>
                    <td className="px-2 py-2">
                      <input value={draft.sku} onChange={(e) => setDrafts((p) => ({ ...p, [l.id]: { ...p[l.id], sku: e.target.value } }))}
                        placeholder="SKU" className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-sm" />
                    </td>
                    <td className="px-2 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        l.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{l.status}</span>
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

// ── Orders Tab ──────────────────────────────────────────────────────────────
function OrdersTab() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [trackingDrafts, setTrackingDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const { data } = await api.get('/orders', { params: { role: 'seller', limit: 50, ...(status ? { status } : {}) } });
      setOrders(data.orders ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load orders.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(statusFilter); }, [statusFilter, load]);

  const updateStatus = async (id: string, status: string) => {
    setUpdatingId(id);
    setError('');
    try {
      const trackingNumber = trackingDrafts[id]?.trim() || undefined;
      // Marking DELIVERED needs the customer's 6-digit code (shown on their
      // order page) — proof they actually received the goods.
      let deliveryCode: string | undefined;
      if (status === 'DELIVERED') {
        const entered = window.prompt("Enter the 6-digit delivery code from the customer's order page:");
        if (!entered) { setUpdatingId(null); return; }
        deliveryCode = entered;
      }
      const { data } = await api.put(`/orders/${id}/status`, { status, trackingNumber, deliveryCode });
      setOrders((prev) => prev.map((o) => o.id === id ? { ...o, ...data.order } : o));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update order.'));
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading orders…</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
      {orders.length === 0 ? (
        <p className="text-center py-10 text-sm text-gray-400">No orders yet.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="border border-gray-100 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">#{o.orderNumber}</p>
                  <p className="text-xs text-gray-400">{formatDate(o.createdAt)} · {o.buyer?.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{formatCurrency(o.total, o.currency)}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{o.status}</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-3 truncate">
                {o.items.map((it) => `${it.title} ×${it.quantity}`).join(', ')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  defaultValue={o.trackingNumber ?? ''}
                  placeholder="Tracking number"
                  onChange={(e) => setTrackingDrafts((p) => ({ ...p, [o.id]: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs w-40"
                />
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) updateStatus(o.id, e.target.value); }}
                  disabled={updatingId === o.id}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                >
                  <option value="">Update status…</option>
                  {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Link href={`/profile/orders/${o.id}`} className="text-xs text-red-600 hover:underline ml-auto">View details →</Link>
              </div>
            </div>
          ))}
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
    { label: 'Total Orders', value: data.totalOrders.toLocaleString() },
    { label: 'Revenue (delivered)', value: formatCurrency(data.revenue, data.currency) },
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

      {Object.keys(data.ordersByStatus).length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Orders by Status</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.ordersByStatus).map(([status, count]) => (
              <span key={status} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
                {status}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

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
                  <p className="text-xs text-gray-400">{formatCurrency(l.price, l.currency)} · Stock: {l.stock}</p>
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

// ── Promotions Tab ───────────────────────────────────────────────────────────
function PromotionsTab() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', type: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED', value: '', minOrderAmount: '', maxUses: '', expiresAt: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/coupons/mine');
      setCoupons(data.coupons ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load promotions.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.value) return;
    setCreating(true);
    setError('');
    try {
      const { data } = await api.post('/coupons', {
        code: form.code.trim(),
        type: form.type,
        value: parseFloat(form.value),
        minOrderAmount: form.minOrderAmount ? parseFloat(form.minOrderAmount) : undefined,
        maxUses: form.maxUses ? parseInt(form.maxUses) : undefined,
        expiresAt: form.expiresAt || undefined,
        description: form.description || undefined,
      });
      setCoupons((prev) => [data.coupon, ...prev]);
      setForm({ code: '', type: 'PERCENTAGE', value: '', minOrderAmount: '', maxUses: '', expiresAt: '', description: '' });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to create promotion.'));
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (c: Coupon) => {
    try {
      const { data } = await api.put(`/coupons/${c.id}`, { isActive: !c.isActive });
      setCoupons((prev) => prev.map((x) => x.id === c.id ? data.coupon : x));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update promotion.'));
    }
  };

  const removeCoupon = async (id: string) => {
    if (!confirm('Delete this promotion?')) return;
    try {
      await api.delete(`/coupons/${id}`);
      setCoupons((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to delete promotion.'));
    }
  };

  const fc = 'border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-full';

  return (
    <div>
      {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

      <form onSubmit={createCoupon} className="grid sm:grid-cols-3 gap-2.5 mb-6 bg-gray-50 border border-gray-100 rounded-xl p-4">
        <input required placeholder="CODE e.g. SAVE10" value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} className={fc} />
        <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'PERCENTAGE' | 'FIXED' }))} className={fc}>
          <option value="PERCENTAGE">% Percentage off</option>
          <option value="FIXED">Fixed amount off</option>
        </select>
        <input required placeholder={form.type === 'PERCENTAGE' ? 'e.g. 10 (10%)' : 'e.g. 5000 (UGX)'} value={form.value}
          onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} className={fc} inputMode="decimal" />
        <input placeholder="Min order amount (optional)" value={form.minOrderAmount}
          onChange={(e) => setForm((f) => ({ ...f, minOrderAmount: e.target.value }))} className={fc} inputMode="decimal" />
        <input placeholder="Max uses (optional)" value={form.maxUses}
          onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} className={fc} inputMode="numeric" />
        <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} className={fc} />
        <input placeholder="Description (optional)" value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={`${fc} sm:col-span-2`} />
        <button type="submit" disabled={creating}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {creating ? 'Creating…' : '+ Create Promotion'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-400 py-6 text-center">Loading promotions…</p>
      ) : coupons.length === 0 ? (
        <p className="text-center py-6 text-sm text-gray-400">No promotions yet — create your first discount code above.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border border-gray-100 rounded-xl p-3">
              <div>
                <p className="font-mono font-bold text-gray-900 text-sm">{c.code}</p>
                <p className="text-xs text-gray-500">
                  {c.type === 'PERCENTAGE' ? `${c.value}% off` : `${c.value} off`}
                  {c.minOrderAmount ? ` · min order ${c.minOrderAmount}` : ''}
                  {' · used '}{c.usedCount}{c.maxUses ? `/${c.maxUses}` : ''}
                  {c.expiresAt ? ` · expires ${formatDate(c.expiresAt)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {c.isActive ? 'Active' : 'Paused'}
                </span>
                <button onClick={() => toggleActive(c)} className="text-xs text-gray-500 hover:text-gray-800 underline">
                  {c.isActive ? 'Pause' : 'Resume'}
                </button>
                <button onClick={() => removeCoupon(c.id)} className="text-xs text-red-500 hover:text-red-700 underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StoreAdvancedToolsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('inventory');
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

  if (authLoading || gateLoading) return <div className="max-w-5xl mx-auto px-4 py-10 text-center text-gray-400">Loading…</div>;

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
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Web Store — Advanced Tools</h1>
          <p className="text-sm text-gray-500 mt-0.5">Professional management tools for your store.</p>
        </div>
        <Link href="/dashboard/store-rental" className="text-xs text-gray-500 hover:text-gray-800 underline whitespace-nowrap">
          ← Back to Dashboard
        </Link>
      </div>

      <div className="flex gap-1.5 mb-6 overflow-x-auto border-b border-gray-100 pb-px">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
              tab === t.id ? 'border-red-600 text-red-700 bg-red-50/50' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        {tab === 'inventory' && <InventoryTab />}
        {tab === 'orders' && <OrdersTab />}
        {tab === 'analytics' && <AnalyticsTab />}
        {tab === 'messages' && <MessagesTab />}
        {tab === 'promotions' && <PromotionsTab />}
      </div>
    </div>
  );
}
