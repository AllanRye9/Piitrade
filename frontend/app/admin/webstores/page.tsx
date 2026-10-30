'use client';

/** /admin/webstores — Merchant applications, plans and approved stores. (Partners live in /admin/partners.) */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

interface Rental {
  id: string;
  entityType: string;
  fee: number;
  currency: string;
  startDate: string;
  endDate: string;
  maxListings: number;
  packageName?: string | null;
  durationDays?: number | null;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  placements: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string; companyName: string | null };
}

const COUNTRY_FLAGS: Record<string, string> = {
  UGANDA: '🇺🇬',
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

  // The API explains refusals precisely (KYC not passed, end date already past...); show that, not a generic failure.
  const apiMessage = (e: unknown, fallback: string) => {
    const d = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
    return d?.message || d?.error || fallback;
  };

  // Reflect a saved change in the table straight away; fetchRentals() then re-syncs.
  const applyUpdatedRental = (updated?: Partial<Rental> & { id: string }) => {
    if (!updated) return;
    setRentals((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  };

  const activationMessage = (
    owner: string,
    data?: { rental?: { status?: string }; store?: { name?: string; isActive?: boolean } | null; effect?: { activated?: boolean; listingsUpdated?: number } },
  ) => {
    if (data?.rental?.status === 'ACTIVE' && data.effect?.activated) {
      const n = data.effect.listingsUpdated;
      return `${owner}'s store is now Active${data.store?.isActive ? ' and operational' : ''}${n ? ` — ${n} listing${n === 1 ? '' : 's'} updated to the new tier` : ''}.`;
    }
    return 'Rental updated.';
  };

  // Reactivate an EXPIRED / CANCELLED rental: opens the editor on ACTIVE with a fresh period pre-filled
  // (the length of the package the store was bought on). The API refuses an Active rental whose end date has passed, so the
  // admin confirms the new date instead of it being silently invented.
  const openReactivate = (rental: Rental) => {
    openEdit(rental);
    const days = rental.durationDays
      ?? Math.max(1, Math.round((new Date(rental.endDate).getTime() - new Date(rental.startDate).getTime()) / 86_400_000));
    setEditStatus('ACTIVE');
    setEditEndDate(new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10));
  };

  const approveRental = async (rental: Rental) => {
    setError('');
    setSuccess('');
    try {
      let data;
      try {
        ({ data } = await api.patch(`/store-rentals/admin/${rental.id}`, { status: 'ACTIVE' }));
      } catch (e) {
        // The server refuses to activate a paid plan that has not been paid. Let the admin override deliberately.
        if (/not been paid/i.test(apiMessage(e, '')) && confirm('This application has not been paid through MoMo. Activate it anyway (e.g. you received the money another way)?')) {
          ({ data } = await api.patch(`/store-rentals/admin/${rental.id}`, { status: 'ACTIVE', allowUnpaid: true }));
        } else {
          throw e;
        }
      }
      applyUpdatedRental(data?.rental);
      setSuccess(activationMessage(rental.user.name, data));
      fetchRentals();
    } catch (e) {
      setError(apiMessage(e, 'Approval failed'));
    }
  };

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
      const { data } = await api.patch(`/store-rentals/admin/${editing.id}`, {
        status: editStatus,
        fee: parseFloat(editFee),
        endDate: editEndDate,
        maxListings: parseInt(editMaxListings),
      });
      applyUpdatedRental(data?.rental);
      setSuccess(activationMessage(editing.user.name, data));
      setEditing(null);
      fetchRentals();
    } catch (e) {
      setError(apiMessage(e, 'Failed to update rental.'));
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
          { label: 'Active Merchants',  value: activeCount,    color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
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
                ? 'bg-red-500 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600'
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
                      {rental.currency} {rental.fee.toLocaleString('en-US')}
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
                            onClick={() => approveRental(rental)}
                            className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors font-medium"
                          >
                            Approve
                          </button>
                        )}
                        {rental.status === 'ACTIVE' && rental.placements?.pendingRenewal != null && typeof rental.placements.pendingRenewal === 'object' && (
                          <button
                            onClick={async () => {
                              try {
                                await api.patch(`/store-rentals/admin/${rental.id}/confirm-renewal`);
                                fetchRentals();
                              } catch (e) {
                                setError(apiMessage(e, 'Renewal confirmation failed'));
                              }
                            }}
                            title="This store already requested a renewal and is awaiting payment confirmation"
                            className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium"
                          >
                            Confirm Renewal
                          </button>
                        )}
                        {(rental.status === 'EXPIRED' || rental.status === 'CANCELLED') && (
                          <button
                            onClick={() => openReactivate(rental)}
                            title="Set to Active with a new billing period (you confirm the end date)"
                            className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors font-medium"
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(rental)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium"
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                />
                {editStatus === 'ACTIVE' && editEndDate && new Date(editEndDate).getTime() <= Date.now() && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    This date has already passed — the API will refuse to activate the store. Pick a future end date.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Max Listings</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={editMaxListings}
                  onChange={(e) => setEditMaxListings(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                />
                <p className="mt-1 text-[11px] text-gray-400">Default cap is 100 active listings per Merchant.</p>
              </div>
            </div>

            {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
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


export default function AdminWebstoresPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN')) router.replace('/admin/auth/login');
  }, [user, authLoading, router]);

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-start gap-4 mb-7">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-2xl shadow-md shrink-0">🏪</div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-black text-gray-900">Merchants</h1>
          <p className="text-sm text-gray-500 mt-0.5">Review Merchant applications (KYC must be passed first), approve or reject them, and manage active stores.</p>
        </div>
        <Link href="/stores" target="_blank" className="shrink-0 hidden sm:flex items-center gap-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">View Merchants ↗</Link>
      </div>
      <RentalsTab />
    </div>
  );
}
