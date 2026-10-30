'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { apiErrorMessage, formatMomoAmount, type MomoPaymentStatus, type MomoPurpose } from '@/lib/momo';
import { MomoSwitchCard } from '@/components/admin/MomoSwitchCard';

interface AdminPayment {
  id: string;
  purpose: MomoPurpose;
  targetId: string;
  userId: string | null;
  status: MomoPaymentStatus;
  amount: number;
  currency: string;
  msisdn: string;
  referenceId: string;
  environment: string;
  financialTransactionId: string | null;
  failureReason: string | null;
  provisionNote: string | null;
  provisionedAt: string | null;
  createdAt: string;
}

const STATUS_CLASS: Record<MomoPaymentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SUCCESSFUL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED: 'bg-red-50 text-red-700 border-red-200',
  EXPIRED: 'bg-gray-100 text-gray-600 border-gray-200',
  NEEDS_REVIEW: 'bg-purple-50 text-purple-700 border-purple-200',
  REFUNDED: 'bg-sky-50 text-sky-700 border-sky-200',
};
const PURPOSE_LABEL: Record<MomoPurpose, string> = {
  SUBSCRIPTION: 'Plan', SUBSCRIPTION_RENEWAL: 'Plan renewal', SUBSCRIPTION_UPGRADE: 'Plan upgrade',
  STORE_RENTAL: 'Merchant', STORE_RENEWAL: 'Merchant renewal', LISTING_TIER: 'Listing tier', CV_DOWNLOAD: 'CV download',
};

export default function AdminPaymentsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AdminPayment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [purpose, setPurpose] = useState('');
  const [search, setSearch] = useState('');
  const [fetching, setFetching] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const limit = 25;

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get('/payments/admin/list', { params: { page, limit, ...(status && { status }), ...(purpose && { purpose }), ...(search.trim() && { search: search.trim() }) } });
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setNotice({ ok: false, text: apiErrorMessage(e, 'Could not load payments.') });
    } finally {
      setFetching(false);
    }
  }, [page, status, purpose, search]);

  useEffect(() => { if (user?.role === 'ADMIN') load(); }, [user, load]);

  const verify = async (p: AdminPayment) => {
    setBusyId(p.id); setNotice(null);
    try {
      await api.post(`/payments/admin/${p.id}/verify`);
      setNotice({ ok: true, text: 'Checked with MTN.' });
      await load();
    } catch (e) { setNotice({ ok: false, text: apiErrorMessage(e, 'Verification failed.') }); }
    finally { setBusyId(null); }
  };

  const resolve = async (p: AdminPayment) => {
    const refunded = window.confirm('How was this payment handled?\n\nOK = REFUNDED (money returned to the payer outside the system)\nCancel = I granted access manually');
    const outcome = refunded ? 'REFUNDED' : 'GRANTED';
    const note = window.prompt(refunded ? 'Refund details (e.g. MoMo refund reference):' : 'What access did you grant manually?');
    if (!note || !note.trim()) return;
    setBusyId(p.id); setNotice(null);
    try {
      await api.post(`/payments/admin/${p.id}/resolve`, { note, outcome });
      setNotice({ ok: true, text: refunded ? 'Marked as refunded.' : 'Marked as granted manually.' });
      await load();
    } catch (e) { setNotice({ ok: false, text: apiErrorMessage(e, 'Could not resolve.') }); }
    finally { setBusyId(null); }
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">MoMo Payments</h1>
        <p className="text-sm text-gray-500">Every MTN Mobile Money collection. <b>Needs review</b> means money arrived but access could not be granted safely — handle it, then mark it resolved.</p>
      </div>

      <MomoSwitchCard />

      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {(['NEEDS_REVIEW', 'PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED', 'REFUNDED'] as const).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={purpose} onChange={(e) => { setPage(1); setPurpose(e.target.value); }} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="">All purposes</option>
          {(Object.keys(PURPOSE_LABEL) as MomoPurpose[]).map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
        </select>
        <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} placeholder="Exact reference / target / user / MTN id"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      </div>

      {notice && <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</p>}

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">For</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Payer</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Detail</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {fetching && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>}
            {!fetching && items.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No payments found.</td></tr>}
            {items.map((p) => (
              <tr key={p.id} className="border-t border-gray-50 align-top">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{new Date(p.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2">{PURPOSE_LABEL[p.purpose] ?? p.purpose}{p.environment === 'sandbox' && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500">sandbox</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold">{formatMomoAmount(p.currency, p.amount)}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{p.msisdn}<br /><span className="text-gray-400">{p.userId ?? 'guest'}</span></td>
                <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_CLASS[p.status]}`}>{p.status.replace('_', ' ')}</span></td>
                <td className="max-w-xs px-3 py-2 text-xs text-gray-500">
                  {p.failureReason || p.provisionNote || (p.status === 'SUCCESSFUL' && p.provisionedAt ? 'Access granted' : '')}
                  <div className="break-all text-[10px] text-gray-300">{p.referenceId}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {(p.status === 'PENDING' || p.status === 'SUCCESSFUL' || p.status === 'NEEDS_REVIEW') && (
                    <button disabled={busyId === p.id} onClick={() => verify(p)} className="mr-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">Re-check</button>
                  )}
                  {p.status === 'NEEDS_REVIEW' && (
                    <button disabled={busyId === p.id} onClick={() => resolve(p)} className="rounded-lg bg-purple-600 px-2 py-1 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50">Mark handled</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{total} payment{total === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40">Prev</button>
          <span>{page} / {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
