'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Currency } from '@/lib/types';

interface ProofRow {
  id: string;
  transactionId: string;
  senderPhone: string;
  amountClaimed: number;
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';
  amountReceived?: number | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  order: {
    id: string;
    orderNumber: string;
    total: number;
    currency: Currency;
    status: string;
    buyer: { id: string; name: string; email: string; phone?: string | null };
  };
  payment: { amount: number; status: string; dueAt?: string | null };
}

const TABS = [
  { key: 'SUBMITTED', label: 'To review' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'REJECTED', label: 'Rejected' },
] as const;

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

/**
 * Manual MTN payments. A buyer's transaction ID is only a CLAIM: find the same
 * transaction on the MTN merchant statement, type the amount that ARRIVED, then
 * confirm. Underpayments cannot be confirmed (reject them or ask for a top-up).
 */
export default function AdminPaymentProofsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('SUBMITTED');
  const [rows, setRows] = useState<ProofRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [received, setReceived] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [authLoading, user, router]);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/payment-proofs/admin', { params: { status: tab } })
      .then(({ data }) => { setRows(data.proofs); setError(''); })
      .catch((e) => setError(errMsg(e, 'Could not load payment proofs.')))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { if (user?.role === 'ADMIN') load(); }, [user, load]);

  const confirm = async (p: ProofRow) => {
    const amountReceived = (received[p.id] ?? String(p.order.total)).trim();
    const late = p.order.status === 'CANCELLED';
    if (!window.confirm(
      `Confirm that ${amountReceived} ${p.order.currency} from ${p.senderPhone} (transaction ${p.transactionId}) appears on the MTN statement?` +
      (late ? `\n\nThis order was CANCELLED for non-payment. Confirming will REINSTATE it and notify the seller.` : ''),
    )) return;
    setBusyId(p.id);
    setError('');
    try {
      await api.post(`/payment-proofs/${p.id}/confirm`, { amountReceived });
      load();
    } catch (e) {
      setError(errMsg(e, 'Could not confirm this payment.'));
    } finally {
      setBusyId('');
    }
  };

  const reject = async (p: ProofRow) => {
    const reason = window.prompt('Why is this being rejected? The buyer will see this message (e.g. "no matching payment on the MTN statement").');
    if (!reason || !reason.trim()) return;
    setBusyId(p.id);
    setError('');
    try {
      await api.post(`/payment-proofs/${p.id}/reject`, { reason: reason.trim() });
      load();
    } catch (e) {
      setError(errMsg(e, 'Could not reject this payment.'));
    } finally {
      setBusyId('');
    }
  };

  if (authLoading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="max-w-5xl p-6">
      <h1 className="text-xl font-extrabold text-gray-900 mb-1">Payment Proofs</h1>
      <p className="text-sm text-gray-500 mb-5">
        Buyers pay your MTN number by hand and submit the transaction ID. Match each one against the MTN statement,
        enter the amount that actually arrived, then confirm. Only a confirmation marks the order as paid. The number,
        account name and payment deadline are set in <a href="/admin/payment-settings" className="underline font-semibold">Payment Gateway</a>.
      </p>

      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === t.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3">{error}</div>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Nothing here.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => {
            const mismatch = p.amountClaimed !== p.order.total;
            return (
              <li key={p.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-bold text-red-600">
                      {p.order.orderNumber}
                      {p.status === 'SUBMITTED' && p.order.status === 'CANCELLED' && (
                        <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 font-sans text-[11px] font-bold text-orange-700">
                          LATE — order was cancelled
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-700">{p.order.buyer.name} · {p.order.buyer.email}{p.order.buyer.phone ? ` · ${p.order.buyer.phone}` : ''}</p>
                    <p className="mt-1 text-xs text-gray-500">Submitted {new Date(p.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Order total</p>
                    <p className="text-lg font-bold">{formatCurrency(p.order.total, p.order.currency)}</p>
                  </div>
                </div>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-xs text-gray-500">MTN transaction ID</dt><dd className="font-mono font-semibold select-all">{p.transactionId}</dd></div>
                  <div><dt className="text-xs text-gray-500">Paid from</dt><dd className="font-semibold select-all">{p.senderPhone}</dd></div>
                  <div>
                    <dt className="text-xs text-gray-500">Buyer says they sent</dt>
                    <dd className={`font-semibold ${mismatch ? 'text-orange-600' : ''}`}>
                      {formatCurrency(p.amountClaimed, p.order.currency)}{mismatch ? ' ⚠ differs from total' : ''}
                    </dd>
                  </div>
                </dl>

                {p.status === 'SUBMITTED' ? (
                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
                    <label className="text-xs font-semibold text-gray-600">
                      Amount that arrived (from statement)
                      <input
                        value={received[p.id] ?? String(p.order.total)}
                        onChange={(e) => setReceived((r) => ({ ...r, [p.id]: e.target.value }))}
                        inputMode="decimal"
                        className="mt-1 block w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </label>
                    <button onClick={() => confirm(p)} disabled={busyId === p.id}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {p.order.status === 'CANCELLED' ? '✓ Confirm & reinstate order' : '✓ Confirm payment'}
                    </button>
                    <button onClick={() => reject(p)} disabled={busyId === p.id}
                      className="rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                      ✗ Reject
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-600">
                    {p.status === 'CONFIRMED'
                      ? `Confirmed${p.amountReceived != null ? ` — ${formatCurrency(p.amountReceived, p.order.currency)} received` : ''}`
                      : `Rejected — ${p.reviewNote || 'no reason recorded'}`}
                    {p.reviewedAt ? ` · ${new Date(p.reviewedAt).toLocaleString()}` : ''}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
