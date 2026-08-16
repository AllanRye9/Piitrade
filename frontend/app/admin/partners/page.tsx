'use client';

/**
 * /admin/partners — "Partners & Stores"
 *
 * Consolidated admin section combining what used to be two separate pages:
 *  - /admin/partners       (partner approval / partner-wall logo management)
 *  - /admin/store-rentals  (store rental subscription approval & limits)
 *
 * Both deal with the same underlying stores/applications, so they now live
 * together as tabs in one place: view applications, approve/reject them,
 * manage approved stores (edit/suspend/delete), see store details (logo,
 * contact, listing count, subscription status), and track activity.
 */

import { useCallback, useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

// ── Shared types ────────────────────────────────────────────────────────────

interface StoreRow {
  id:                string;
  name:              string;
  slug:              string;
  logo:              string | null;
  isActive:          boolean;
  partnerApproved:   boolean;
  partnerLogoUrl:    string | null;
  partnerName:       string | null;
  partnerWebsite:    string | null;
  partnerApprovedAt: string | null;
  createdAt:         string;
  user: {
    id:          string;
    name:        string;
    email:       string;
    companyName: string | null;
    country:     string;
    role:        string;
  };
}

interface Rental {
  id: string;
  entityType: string;
  fee: number;
  currency: string;
  startDate: string;
  endDate: string;
  maxListings: number;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  placements: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string; companyName: string | null };
}

const COUNTRY_FLAGS: Record<string, string> = {
  UAE: '🇦🇪', UGANDA: '🇺🇬', KENYA: '🇰🇪', CHINA: '🇨🇳',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-red-100 text-red-600',
};

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Tab 1: Rentals & Applications ────────────────────────────────────────────
// Approve/reject store subscription applications, manage fee, end date, and
// the per-store maxListings cap (default 100 — enforced when posting listings).

function RentalsTab() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [fetching, setFetching] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<Rental | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editFee, setEditFee] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editMaxListings, setEditMaxListings] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchRentals = useCallback(async () => {
    try {
      setFetching(true);
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await api.get('/store-rentals/admin/all', { params });
      setRentals(data.rentals || []);
    } catch {
      setError('Failed to load rentals');
    } finally {
      setFetching(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchRentals(); }, [fetchRentals]);

  const openEdit = (rental: Rental) => {
    setEditing(rental);
    setEditStatus(rental.status);
    setEditFee(String(rental.fee));
    setEditEndDate(rental.endDate.slice(0, 10));
    setEditMaxListings(String(rental.maxListings));
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await api.patch(`/store-rentals/admin/${editing.id}`, {
        status: editStatus,
        fee: parseFloat(editFee),
        endDate: editEndDate,
        maxListings: parseInt(editMaxListings),
      });
      setSuccess('Rental updated.');
      setEditing(null);
      fetchRentals();
    } catch {
      setError('Failed to update rental.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rental? This cannot be undone.')) return;
    try {
      await api.delete(`/store-rentals/admin/${id}`);
      fetchRentals();
    } catch {
      setError('Delete failed');
    }
  };

  const pendingCount = rentals.filter((r) => r.status === 'PENDING').length;
  const activeCount  = rentals.filter((r) => r.status === 'ACTIVE').length;

  return (
    <div>
      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {success && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">{success}</div>}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Applications', value: rentals.length, color: 'text-gray-700',    bg: 'bg-gray-50',    border: 'border-gray-200' },
          { label: 'Active Stores',      value: activeCount,    color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
          { label: 'Awaiting Approval',  value: pendingCount,   color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} ${s.border} border rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        {['', 'PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              statusFilter === s
                ? 'bg-sky-500 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-sky-300 hover:text-sky-600'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {fetching ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : rentals.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <p className="text-3xl mb-2">🏪</p>
            <p className="text-sm">No rentals found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Applicant</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Period</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Fee</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Max Listings</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rentals.map((rental) => (
                  <tr key={rental.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{rental.user.name}</p>
                      <p className="text-xs text-gray-400">{rental.user.email}</p>
                      {rental.user.companyName && (
                        <p className="text-xs text-gray-500">{rental.user.companyName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                        {rental.entityType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <p>{formatDate(rental.startDate)}</p>
                      <p>→ {formatDate(rental.endDate)}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-800">
                      {rental.currency} {rental.fee.toLocaleString()}
                      {typeof rental.placements?.subscriptionPlan === 'string' && (
                        <p className="text-[11px] font-medium text-gray-500 mt-0.5">
                          {rental.placements.subscriptionPlan.replace('_', ' ')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{rental.maxListings}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[rental.status] || 'bg-gray-100 text-gray-600'}`}>
                        {rental.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {rental.status === 'PENDING' && (
                          <button
                            onClick={async () => {
                              try {
                                await api.patch(`/store-rentals/admin/${rental.id}`, { status: 'ACTIVE' });
                                fetchRentals();
                              } catch {
                                setError('Approval failed');
                              }
                            }}
                            className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors font-medium"
                          >
                            Approve
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(rental)}
                          className="text-xs px-2 py-1 rounded bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(rental.id)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-500 hover:bg-red-100 transition-colors font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-base font-bold text-gray-900 mb-4">Edit Rental — {editing.user.name}</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  {['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Fee ({editing.currency})</label>
                <input
                  type="number"
                  min={0}
                  value={editFee}
                  onChange={(e) => setEditFee(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Max Listings</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={editMaxListings}
                  onChange={(e) => setEditMaxListings(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
                <p className="mt-1 text-[11px] text-gray-400">Default cap is 100 active listings per store.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 bg-sky-600 text-white text-sm font-semibold rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="flex-1 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Partners ───────────────────────────────────────────────────────────
// Approve/revoke partner status for stores. Approved stores' logos appear
// automatically on the public /stores Partners wall.

function PartnersTab() {
  const [stores, setStores]       = useState<StoreRow[]>([]);
  const [fetching, setFetching]   = useState(true);
  const [acting, setActing]       = useState<string | null>(null);
  const [filter, setFilter]       = useState<'all' | 'approved' | 'pending'>('all');
  const [search, setSearch]       = useState('');
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchStores = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get('/admin/stores/partners');
      setStores(data.stores || []);
    } catch {
      showToast('Failed to load stores', false);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  const approve = async (storeId: string, storeName: string) => {
    setActing(storeId);
    try {
      await api.patch(`/admin/stores/${storeId}/partner-approve`);
      showToast(`✓ "${storeName}" is now an approved partner`, true);
      await fetchStores();
    } catch {
      showToast('Approval failed — please try again', false);
    } finally {
      setActing(null);
    }
  };

  const revoke = async (storeId: string, storeName: string) => {
    if (!confirm(`Revoke partner status for "${storeName}"? Their logo will be removed from the Partners wall immediately.`)) return;
    setActing(storeId);
    try {
      await api.patch(`/admin/stores/${storeId}/partner-revoke`);
      showToast(`Partner status revoked for "${storeName}"`, true);
      await fetchStores();
    } catch {
      showToast('Revoke failed — please try again', false);
    } finally {
      setActing(null);
    }
  };

  const visible = stores.filter((s) => {
    if (filter === 'approved' && !s.partnerApproved) return false;
    if (filter === 'pending' && s.partnerApproved) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.user.name.toLowerCase().includes(q) ||
        s.user.email.toLowerCase().includes(q) ||
        (s.user.companyName || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const approvedCount = stores.filter((s) => s.partnerApproved).length;
  const pendingCount  = stores.filter((s) => !s.partnerApproved).length;

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold text-white transition-all ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Stores',       value: stores.length,   color: 'text-gray-700',    bg: 'bg-gray-50',    border: 'border-gray-200' },
          { label: 'Approved Partners',  value: approvedCount,   color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
          { label: 'Awaiting Decision',  value: pendingCount,    color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} ${s.border} border rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input
          type="text"
          placeholder="Search by store name, owner, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
        <div className="flex gap-2">
          {(['all', 'approved', 'pending'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all capitalize ${
                filter === f
                  ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'
              }`}>
              {f === 'all' ? `All (${stores.length})` : f === 'approved' ? `Partners (${approvedCount})` : `Pending (${pendingCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {fetching ? (
          <div className="p-10 text-center">
            <div className="w-8 h-8 border-4 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400">Loading stores…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-3xl mb-3">🏪</p>
            <p className="text-sm text-gray-500 font-medium">
              {stores.length === 0 ? 'No stores registered yet.' : 'No stores match your search / filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Store</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider hidden md:table-cell">Owner / Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Partner Logo</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map((store) => (
                  <tr key={store.id} className="hover:bg-gray-50/60 transition-colors">

                    {/* Store info */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                          {store.logo ? (
                            <Image src={resolveImageUrl(store.logo)} alt={store.name}
                              width={40} height={40} className="object-cover w-full h-full" />
                          ) : (
                            <span className="text-gray-400 text-lg">🏪</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/stores/${store.slug}`} target="_blank"
                            className="font-semibold text-gray-900 hover:text-sky-600 transition-colors truncate block max-w-[180px]">
                            {store.name}
                          </Link>
                          <p className="text-[11px] text-gray-400 truncate max-w-[180px]">
                            {COUNTRY_FLAGS[store.user.country] || '🌍'} {store.user.country}
                            {!store.isActive && <span className="ml-1 text-red-400">(inactive)</span>}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Owner / Contact */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="font-medium text-gray-700 truncate max-w-[160px]">
                        {store.user.companyName || store.user.name}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate max-w-[160px]">{store.user.email}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{store.user.role.toLowerCase()}</p>
                    </td>

                    {/* Partner logo */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {store.partnerLogoUrl || store.logo ? (
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                            <Image src={resolveImageUrl(store.partnerLogoUrl || store.logo || '')}
                              alt={`${store.partnerName || store.name} logo`}
                              width={40} height={40} className="object-contain p-0.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-700 truncate max-w-[120px]">
                              {store.partnerName || store.name}
                            </p>
                            {store.partnerWebsite && (
                              <a href={store.partnerWebsite.startsWith('http') ? store.partnerWebsite : `https://${store.partnerWebsite}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-[10px] text-sky-500 hover:underline truncate max-w-[120px] block">
                                {store.partnerWebsite.replace(/^https?:\/\//, '')}
                              </a>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-gray-400 italic">
                          {store.partnerApproved ? 'No logo uploaded yet' : '—'}
                        </span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3 text-center">
                      {store.partnerApproved ? (
                        <div>
                          <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2.5 py-1 rounded-full">
                            ✓ Partner
                          </span>
                          {store.partnerApprovedAt && (
                            <p className="text-[9px] text-gray-400 mt-0.5">
                              {new Date(store.partnerApprovedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-500 text-[11px] font-semibold px-2.5 py-1 rounded-full">
                          Not a Partner
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!store.partnerApproved ? (
                          <button
                            onClick={() => approve(store.id, store.name)}
                            disabled={acting === store.id}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            {acting === store.id
                              ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              : '✓'
                            }
                            Approve
                          </button>
                        ) : (
                          <button
                            onClick={() => revoke(store.id, store.name)}
                            disabled={acting === store.id}
                            className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold border border-red-200 transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            {acting === store.id
                              ? <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                              : '×'
                            }
                            Revoke
                          </button>
                        )}
                        <Link href={`/stores/${store.slug}`} target="_blank"
                          className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold transition-colors">
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-5 bg-sky-50 border border-sky-200 rounded-xl p-4 flex gap-3">
        <span className="text-lg shrink-0">ℹ️</span>
        <div className="text-sm text-sky-800 space-y-1">
          <p><strong>Approval flow:</strong> Click <em>Approve</em> → the store&rsquo;s own logo (or a separate one uploaded from <code className="bg-sky-100 px-1 rounded text-xs">/dashboard/partner-logo</code>) appears automatically on the Partners wall.</p>
          <p><strong>Revoke:</strong> Immediately removes the logo from the public Partners wall and resets upload permission.</p>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type TabKey = 'rentals' | 'partners';

function AdminPartnersAndStoresInner() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab: TabKey = searchParams?.get('tab') === 'partners' ? 'partners' : 'rentals';
  const [tab, setTab] = useState<TabKey>(initialTab);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN')) router.replace('/admin/auth/login');
  }, [user, authLoading, router]);

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-start gap-4 mb-7">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-2xl shadow-md shrink-0">
          🤝
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-black text-gray-900">Partners & Stores</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Review store applications, approve or reject them, manage approved stores, and control the{' '}
            <Link href="/stores" target="_blank" className="text-sky-600 hover:underline font-semibold">
              public Partners wall
            </Link>.
          </p>
        </div>
        <Link href="/stores" target="_blank"
          className="shrink-0 hidden sm:flex items-center gap-1.5 text-xs font-semibold text-sky-600 border border-sky-200 hover:bg-sky-50 px-3 py-2 rounded-lg transition-colors">
          View Partners Wall ↗
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {([
          { key: 'rentals' as const,  label: 'Applications & Rentals', icon: '📋' },
          { key: 'partners' as const, label: 'Partners',               icon: '🤝' },
        ]).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 -mb-px ${
              tab === key
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{icon}</span> {label}
          </button>
        ))}
      </div>

      {tab === 'rentals' ? <RentalsTab /> : <PartnersTab />}
    </div>
  );
}

export default function AdminPartnersAndStoresPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <AdminPartnersAndStoresInner />
    </Suspense>
  );
}
