'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

interface PaymentSettings {
  mobileMoneyEnabled: boolean;
  mobileMoneyNumber: string;
  mobileMoneyInstructions: string;
  codEnabled: boolean;
}

const DEFAULTS: PaymentSettings = {
  mobileMoneyEnabled: true,
  mobileMoneyNumber: '',
  mobileMoneyInstructions: '',
  codEnabled: true,
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
    } catch {
      setError('Failed to save. Please try again.');
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
        Card and Bank Transfer are no longer offered to buyers — everyone except admins is put in touch with
        the seller directly (Call/WhatsApp) instead of an online checkout. This page only configures the two
        channels left for the admin-only checkout flow.
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
