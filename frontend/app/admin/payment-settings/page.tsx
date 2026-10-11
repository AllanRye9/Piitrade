'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

interface PaymentSettings {
  mobileMoneyEnabled: boolean;
  mobileMoneyNumber: string;
  /** Name registered on the MTN number; shown to buyers so they can check the recipient. */
  mobileMoneyAccountName: string;
  mobileMoneyInstructions: string;
  /** Minutes a buyer has to pay and submit their MTN transaction ID (5–1440). */
  paymentDeadlineMinutes: number;
  codEnabled: boolean;
  // % of each delivered order (total minus shipping) kept by the platform
  // before the seller is credited. 0 = no fee. See backend orderLifecycle.ts.
  platformFeePercent: number;
}

const DEFAULTS: PaymentSettings = {
  mobileMoneyEnabled: true,
  mobileMoneyNumber: '',
  mobileMoneyAccountName: '',
  mobileMoneyInstructions: '',
  paymentDeadlineMinutes: 30,
  codEnabled: true,
  platformFeePercent: 0,
};

export default function AdminPaymentSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [settings, setSettings] = useState<PaymentSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    api.get('/admin/payment-settings')
      .then(({ data }) => setSettings({ ...DEFAULTS, ...data }))
      .catch(() => setError('Could not load payment settings.'))
      .finally(() => setLoading(false));
  }, [user]);

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const { data } = await api.put('/admin/payment-settings', settings);
      setSettings({ ...DEFAULTS, ...data });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  return (
    <div className="max-w-2xl p-6">
      <h1 className="text-xl font-extrabold text-gray-900 mb-1">Payment Gateway</h1>
      <p className="text-sm text-gray-500 mb-6">
        Card and Bank Transfer are not offered. <strong>Mobile Money</strong> (paid by hand to the number below,
        then confirmed by an admin on the <strong>Payment Proofs</strong> page) applies to listings sold by
        <strong> Piitrade</strong> and by <strong>web stores</strong>. <strong>Cash on Delivery</strong> applies only to
        Piitrade&apos;s own listings. Buyers of any other seller&apos;s listings are put in touch with that seller
        directly (Call/WhatsApp/chat). Motors and Property always use Call/WhatsApp too. Keep Marketplace Mode on
        &quot;Hybrid&quot; for this behaviour.
      </p>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm px-4 py-3">{error}</div>
      )}

      <div className="space-y-5">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <label className="flex items-center justify-between cursor-pointer mb-4">
            <span className="text-sm font-bold text-gray-900">Mobile Money</span>
            <input
              type="checkbox"
              checked={settings.mobileMoneyEnabled}
              onChange={(e) => setSettings((s) => ({ ...s, mobileMoneyEnabled: e.target.checked }))}
              className="w-5 h-5 rounded accent-emerald-600"
            />
          </label>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Receiving Number</label>
              <input
                type="text"
                value={settings.mobileMoneyNumber}
                onChange={(e) => setSettings((s) => ({ ...s, mobileMoneyNumber: e.target.value }))}
                placeholder="e.g. +256 700 000 000"
                disabled={!settings.mobileMoneyEnabled}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Name registered on this number</label>
              <input
                type="text"
                value={settings.mobileMoneyAccountName}
                onChange={(e) => setSettings((s) => ({ ...s, mobileMoneyAccountName: e.target.value }))}
                placeholder="e.g. Piitrade Ltd"
                disabled={!settings.mobileMoneyEnabled}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <p className="mt-1 text-xs text-gray-500">Shown to buyers so they can check the recipient name before confirming the transfer.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Payment deadline (minutes)</label>
              <input
                type="number"
                min={5}
                max={1440}
                step={1}
                value={settings.paymentDeadlineMinutes}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setSettings((s) => ({ ...s, paymentDeadlineMinutes: Number.isFinite(n) ? n : 30 }));
                }}
                disabled={!settings.mobileMoneyEnabled}
                className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <p className="mt-1 text-xs text-gray-500">
                Buyer must pay and submit the MTN transaction ID within this time (5–1440 min, default 30) or the unpaid order is
                cancelled automatically. An order whose payment details are waiting for your review is never cancelled.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Instructions shown at checkout</label>
              <textarea
                value={settings.mobileMoneyInstructions}
                onChange={(e) => setSettings((s) => ({ ...s, mobileMoneyInstructions: e.target.value }))}
                rows={2}
                disabled={!settings.mobileMoneyEnabled}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm font-bold text-gray-900">Cash on Delivery</span>
            <input
              type="checkbox"
              checked={settings.codEnabled}
              onChange={(e) => setSettings((s) => ({ ...s, codEnabled: e.target.checked }))}
              className="w-5 h-5 rounded accent-emerald-600"
            />
          </label>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <label className="block text-sm font-bold text-gray-900 mb-1">Platform fee (%)</label>
          <p className="text-xs text-gray-500 mb-3">
            Kept by Piitrade on every delivered order (calculated on the order total minus shipping).
            The rest is credited to the seller when the order is marked delivered. Enter 0 for no fee.
          </p>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={settings.platformFeePercent}
            onChange={(e) => {
              const n = Number(e.target.value);
              const clamped = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
              setSettings((s) => ({ ...s, platformFeePercent: clamped }));
            }}
            className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold px-6 py-2.5 transition-colors"
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
      </button>
    </div>
  );
}
