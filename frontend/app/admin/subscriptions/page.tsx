'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PackageScope, SellerSubscription, SubscriptionStatus } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { formatDuration, formatAllowance, formatPackagePrice } from '@/lib/subscriptionPlans';

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  PENDING_PAYMENT: 'Pending Payment',
};

const STATUS_CLASSES: Record<SubscriptionStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPIRED: 'bg-gray-100 text-gray-600 border-gray-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
  PENDING_PAYMENT: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function AdminSubscriptionsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<SellerSubscription[]>([]);
  const [fetching, setFetching] = useState(true);
  const [filter, setFilter] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [actionId, setActionId] = useState<string | null>(null);
  const [scope, setScope] = useState<PackageScope>('LISTING');
  const [reviewing, setReviewing] = useState<SellerSubscription | null>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [dialogError, setDialogError] = useState('');

  const fetchSubs = useCallback(async (pg = 1, status = '') => {
    setFetching(true);
    try {
      const { data } = await api.get('/admin/subscriptions', {
        params: { page: pg, limit: 20, scope, ...(status && { status }) },
      });
      setSubscriptions(data.subscriptions ?? []);
      setTotal(data.total ?? 0);
      setPage(data.page ?? 1);
      setPages(data.pages ?? 1);
    } catch {
      // ignore
    } finally {
      setFetching(false);
    }
  }, [scope]);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'ADMIN') fetchSubs(1, filter);
  }, [user, fetchSubs, filter]);

  const apiMessage = (e: unknown, fallback: string) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

  // Simple transitions (cancel an active plan, revive one with an explicit end date).
  const handleStatusChange = async (id: string, status: SubscriptionStatus, extra: Record<string, unknown> = {}) => {
    setActionId(id);
    setNotice(null);
    try {
      await api.put(`/admin/subscriptions/${id}`, { status, ...extra });
      await fetchSubs(page, filter);
      setNotice({ ok: true, text: status === 'CANCELLED' ? 'Subscription cancelled.' : 'Subscription updated.' });
    } catch (e) {
      setNotice({ ok: false, text: apiMessage(e, 'Could not update the subscription.') });
    } finally {
      setActionId(null);
    }
  };

  const reviveExpired = (sub: SellerSubscription) => {
    const input = window.prompt('Reactivate until which date? (YYYY-MM-DD, must be in the future)');
    if (!input) return;
    const d = new Date(`${input}T23:59:59`);
    if (Number.isNaN(d.getTime())) { setNotice({ ok: false, text: 'That is not a valid date.' }); return; }
    handleStatusChange(sub.id, 'ACTIVE', { endDate: d.toISOString() });
  };

  // Approval sends back exactly the package details that were on screen; the API refuses if they
  // are missing or no longer match what the customer requested.
  const approve = async () => {
    if (!reviewing?.terms) return;
    setActionId(reviewing.id);
    setDialogError('');
    try {
      await api.put(`/admin/subscriptions/${reviewing.id}`, {
        status: 'ACTIVE',
        note: note.trim() || undefined,
        review: {
          packageId: reviewing.packageId,
          price: reviewing.terms.price,
          currency: reviewing.terms.currency,
          durationDays: reviewing.terms.durationDays,
          maxListings: reviewing.terms.maxListings,
        },
      });
      setReviewing(null);
      setNote('');
      await fetchSubs(page, filter);
      setNotice({ ok: true, text: 'Approved — the customer has been notified.' });
    } catch (e) {
      setDialogError(apiMessage(e, 'Could not approve this request.'));
    } finally {
      setActionId(null);
    }
  };

  const decline = async () => {
    if (!reviewing) return;
    if (!note.trim()) { setDialogError('Add a short reason — the customer will see it.'); return; }
    setActionId(reviewing.id);
    setDialogError('');
    try {
      await api.put(`/admin/subscriptions/${reviewing.id}`, { status: 'CANCELLED', note: note.trim() });
      setReviewing(null);
      setNote('');
      await fetchSubs(page, filter);
      setNotice({ ok: true, text: 'Request declined.' });
    } catch (e) {
      setDialogError(apiMessage(e, 'Could not decline this request.'));
    } finally {
      setActionId(null);
    }
  };

  const kindLabel = (sub: SellerSubscription) =>
    sub.changeKind === 'UPGRADE' ? (sub.upgradeMode === 'IMMEDIATE' ? 'Upgrade · switch now' : 'Upgrade · after current plan')
    : sub.changeKind === 'RENEWAL' ? 'Renewal' : 'New';

  if (loading) return null;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Seller Subscriptions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of listing and CV subscriptions. Manage their status or extend them as needed.
        </p>
      </div>

      {notice && (
        <p role="status" className={`mb-4 rounded-xl border px-3 py-2 text-sm ${notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(['LISTING', 'CV'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setScope(value);
              setPage(1);
            }}
            className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-colors ${
              scope === value
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {value === 'LISTING' ? 'Listing Subscriptions' : 'CV Subscriptions'}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-6 flex flex-wrap gap-3 items-center">
        <span className="text-sm font-medium text-gray-700">Filter by status:</span>
        {(['', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING_PAYMENT'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setFilter(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              filter === s
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s === '' ? 'All' : STATUS_LABELS[s as SubscriptionStatus]}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400">{total} total</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {fetching ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : subscriptions.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">No subscriptions found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Seller', 'Package', 'Status', 'Start', 'End', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{sub.user?.name ?? '—'}</p>
                      <p className="text-xs text-gray-400">{sub.user?.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{sub.terms?.packageName ?? sub.package.name}</p>
                      <p className="text-xs text-gray-400">
                        {sub.package.scope} {' · '}
                        {formatPackagePrice(sub.terms?.price ?? sub.package.price, String(sub.terms?.currency ?? sub.package.currency))}
                        {' · '}{formatDuration(sub.terms?.durationDays ?? sub.package.durationDays)}
                      </p>
                      <p className="text-[11px] text-gray-400">{kindLabel(sub)}{sub.paymentRef ? ` · ref ${sub.paymentRef}` : ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-semibold border px-2 py-0.5 rounded-full ${STATUS_CLASSES[sub.status]}`}>
                        {STATUS_LABELS[sub.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(sub.startDate)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      <span className={new Date(sub.endDate) < new Date() && sub.status === 'ACTIVE' ? 'text-red-500 font-semibold' : ''}>
                        {formatDate(sub.endDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {sub.status === 'PENDING_PAYMENT' && (
                          <button
                            disabled={actionId === sub.id}
                            onClick={() => { setReviewing(sub); setNote(''); setDialogError(''); }}
                            className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50"
                          >
                            Review &amp; approve
                          </button>
                        )}
                        {(sub.status === 'EXPIRED' || sub.status === 'CANCELLED') && (
                          <button
                            disabled={actionId === sub.id}
                            onClick={() => reviveExpired(sub)}
                            className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                          >
                            Reactivate…
                          </button>
                        )}
                        {sub.status === 'ACTIVE' && (
                          <button
                            disabled={actionId === sub.id}
                            onClick={() => { if (window.confirm('Cancel this subscription now?')) handleStatusChange(sub.id, 'CANCELLED'); }}
                            className="px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => fetchSubs(page - 1, filter)}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              ← Previous
            </button>
            <span className="text-xs text-gray-500">Page {page} of {pages}</span>
            <button
              onClick={() => fetchSubs(page + 1, filter)}
              disabled={page >= pages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
      {reviewing && reviewing.terms && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" onClick={() => !actionId && setReviewing(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-extrabold text-gray-900">Review request</h3>
            <p className="text-xs text-gray-500">{reviewing.user?.name} · {reviewing.user?.email}</p>

            <div className="mt-3 rounded-xl border border-gray-200 p-3">
              <p className="text-sm font-bold text-gray-900">{reviewing.terms.packageName} <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">{kindLabel(reviewing)}</span></p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ['Price', formatPackagePrice(reviewing.terms.price, String(reviewing.terms.currency))],
                  ['Duration', formatDuration(reviewing.terms.durationDays)],
                  ['Allowance', formatAllowance(reviewing.terms.maxListings, scope)],
                  ['Payment ref', reviewing.paymentRef || '— none —'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-gray-50 px-2 py-1.5"><dt className="text-[10px] font-semibold uppercase text-gray-400">{k}</dt><dd className={`font-bold ${v === '— none —' ? 'text-red-600' : 'text-gray-800'}`}>{v}</dd></div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] text-gray-500">These are the terms the customer requested. Later edits to the package do not change them.</p>
            </div>

            <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3 text-xs text-violet-900">
              {reviewing.changeKind === 'UPGRADE' && reviewing.replaces ? (
                reviewing.upgradeMode === 'IMMEDIATE'
                  ? <>On approval <b>{reviewing.replaces.packageName}</b> is cancelled and this plan starts today.</>
                  : <>On approval this plan is queued to start on <b>{formatDate(reviewing.replaces.endDate)}</b>, when <b>{reviewing.replaces.packageName}</b> ends.</>
              ) : reviewing.changeKind === 'RENEWAL'
                ? <>On approval this term is added after any time the customer still has.</>
                : <>On approval this plan starts today and runs {formatDuration(reviewing.terms.durationDays)}.</>}
            </div>

            <label className="mt-3 block text-xs font-semibold text-gray-700">Note to customer (required to decline)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
            {dialogError && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{dialogError}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={!!actionId} onClick={() => setReviewing(null)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Close</button>
              <button type="button" disabled={!!actionId} onClick={decline} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">Decline</button>
              <button type="button" disabled={!!actionId || (reviewing.terms.price > 0 && !reviewing.paymentRef)} onClick={approve} className="ml-auto rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {actionId ? 'Working…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
