'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Order } from '@/lib/types';

const MAX_PROOFS = 3; // keep in sync with MAX_PROOFS_PER_ORDER in the backend

function useRemainingMs(dueAt?: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!dueAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [dueAt]);
  return dueAt ? new Date(dueAt).getTime() - now : null;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Buyer pays the admin's MTN number by hand, then submits the transaction ID.
 * Nothing here marks the order paid — an admin confirms it against the MTN statement.
 */
export function MobileMoneyPaymentCard({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const info = order.paymentInfo;
  const proofs = order.paymentProofs ?? [];
  const remaining = useRemainingMs(info?.dueAt);
  const [form, setForm] = useState({ transactionId: '', senderPhone: '', amount: String(order.total) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  if (!info || order.payment?.method !== 'MOBILE_MONEY') return null;

  // LATE payment: the order was cancelled because the payment window closed (the
  // system marks that payment FAILED). If the buyer did pay, they can still send the
  // transaction ID for a limited time; an admin confirms it and reinstates the order.
  const lateMode = order.status === 'CANCELLED' && order.payment.status === 'FAILED';
  const normalMode = order.status === 'PENDING' && order.payment.status === 'PENDING';
  if (!lateMode && !normalMode) return null;

  const pending = proofs.find((p) => p.status === 'SUBMITTED');
  const lastRejected = !pending && proofs[0]?.status === 'REJECTED' ? proofs[0] : null;
  const expired = !lateMode && remaining !== null && remaining <= 0;
  const canSubmit = !pending && !expired && proofs.length < MAX_PROOFS;

  const copyNumber = async () => {
    try { await navigator.clipboard.writeText(info.number); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/payment-proofs', { orderId: order.id, ...form });
      onChanged();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not submit. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (lateMode) {
    return (
      <div className="rounded-2xl border border-orange-300 bg-orange-50 p-5 space-y-4">
        <h2 className="font-bold text-gray-900">⏰ This order was cancelled — payment not received in time</h2>
        {pending ? (
          <div className="rounded-lg bg-white border border-gray-200 p-3 text-sm">
            ⏳ <strong>Waiting for confirmation.</strong> We received transaction <span className="font-mono">{pending.transactionId}</span>. If the payment is
            on our MTN statement, an admin will confirm it and <strong>reinstate your order</strong>. This page updates automatically.
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-800">
              <strong>If you already sent the money</strong> (please don&apos;t pay again), enter your MTN transaction ID below. An admin will check it and, if it
              matches, reinstate your order. If you did not pay, you can ignore this — nothing was charged.
            </p>
            {lastRejected && (
              <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                Your last submission (<span className="font-mono">{lastRejected.transactionId}</span>) could not be confirmed: {lastRejected.reviewNote || 'no matching payment found'}.
              </p>
            )}
            {canSubmit && (
              <form onSubmit={submit} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-gray-700">MTN transaction ID</span>
                    <input required value={form.transactionId} onChange={(e) => setForm({ ...form, transactionId: e.target.value })} autoCapitalize="characters" autoComplete="off"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-gray-700">Phone you paid from</span>
                    <input required value={form.senderPhone} onChange={(e) => setForm({ ...form, senderPhone: e.target.value })} inputMode="tel" autoComplete="tel"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="font-medium text-gray-700">Amount you sent</span>
                  <input required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </label>
                {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</p>}
                <button type="submit" disabled={busy} className="w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50">
                  {busy ? 'Submitting…' : 'I already paid — submit transaction ID'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-yellow-300 bg-yellow-50 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-bold text-gray-900">📱 Pay with MTN Mobile Money</h2>
        {remaining !== null && (
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${expired ? 'bg-red-100 text-red-700' : remaining < 5 * 60_000 ? 'bg-orange-100 text-orange-700' : 'bg-white text-gray-700'}`} aria-live="polite">
            {expired ? 'Time is up' : `${mmss(remaining)} left`}
          </span>
        )}
      </div>

      {!info.number ? (
        <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          The payment number has not been set up yet. Please contact support before sending any money.
        </p>
      ) : (
        <ol className="space-y-3 text-sm text-gray-800">
          <li>
            <span className="font-semibold">1. Send exactly</span>{' '}
            <strong className="text-base">{formatCurrency(order.total, order.currency)}</strong> to
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-lg font-bold tracking-wide select-all">{info.number}</span>
              <button type="button" onClick={copyNumber} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-gray-50">
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            {info.accountName && <p className="mt-1 text-xs text-gray-600">Name on the account: <strong>{info.accountName}</strong> — check it matches before you confirm.</p>}
          </li>
          <li><span className="font-semibold">2. Reference:</span> use <strong className="font-mono">{order.orderNumber}</strong>.</li>
          <li><span className="font-semibold">3. Then enter the MTN transaction ID below</span> so we can find your payment.</li>
        </ol>
      )}
      {info.instructions && <p className="text-xs text-gray-600 whitespace-pre-line">{info.instructions}</p>}

      {pending && (
        <div className="rounded-lg bg-white border border-gray-200 p-3 text-sm">
          ⏳ <strong>Waiting for confirmation.</strong> We received transaction <span className="font-mono">{pending.transactionId}</span> and are checking it
          against our MTN statement. This page updates automatically once it is confirmed.
        </div>
      )}

      {lastRejected && (
        <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          Your last submission (<span className="font-mono">{lastRejected.transactionId}</span>) could not be confirmed: {lastRejected.reviewNote || 'no matching payment found'}.
          {canSubmit ? ' Please check the details and submit again.' : ''}
        </p>
      )}

      {expired && !pending && (
        <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          The payment window has closed and this order will be cancelled. <strong>If you already sent the money</strong>, contact support with your MTN transaction ID — do not pay again.
        </p>
      )}

      {canSubmit && info.number && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-gray-700">MTN transaction ID</span>
              <input required value={form.transactionId} onChange={(e) => setForm({ ...form, transactionId: e.target.value })} autoCapitalize="characters" autoComplete="off"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Phone you paid from</span>
              <input required value={form.senderPhone} onChange={(e) => setForm({ ...form, senderPhone: e.target.value })} inputMode="tel" autoComplete="tel"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Amount you sent</span>
            <input required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-yellow-500 py-3 text-sm font-bold text-gray-900 hover:bg-yellow-400 disabled:opacity-50">
            {busy ? 'Submitting…' : 'I have paid — submit transaction ID'}
          </button>
        </form>
      )}
    </div>
  );
}
