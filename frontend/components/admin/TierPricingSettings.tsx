'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface TierPricingConfig {
  currency: 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD';
  listingGoldPrice: number;
  listingPlatinumPrice: number;
  listingTierDurationDays: number;
  storeFreeFee: number;
  storeGoldFee: number;
  storePlatinumFee: number;
}

const DEFAULT_CONFIG: TierPricingConfig = {
  currency: 'UGX',
  listingGoldPrice: 20000,
  listingPlatinumPrice: 50000,
  listingTierDurationDays: 30,
  storeFreeFee: 60000,
  storeGoldFee: 150000,
  storePlatinumFee: 400000,
};

const CURRENCIES: TierPricingConfig['currency'][] = ['UGX', 'AED', 'KES', 'CNY', 'USD'];

/**
 * Admin control for "Sets pricing packages for Free, Gold, Platinum" — the
 * one place both purchase paths in the spec are priced from: an ordinary
 * user's per-listing tier selector (shown just before "Post Listing") and
 * a store's subscription tier (chosen once, in the Store Dashboard).
 */
export default function TierPricingSettings() {
  const [config, setConfig] = useState<TierPricingConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    api.get('/admin/site-config/tier-pricing')
      .then(({ data }) => setConfig({ ...DEFAULT_CONFIG, ...data }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const flash = useCallback((text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/admin/site-config/tier-pricing', config);
      setConfig({ ...DEFAULT_CONFIG, ...data });
      flash('Tier pricing saved');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save';
      flash(msg, true);
    } finally {
      setSaving(false);
    }
  };

  const numberField = (label: string, key: keyof TierPricingConfig, hint?: string) => (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-12 shrink-0">{config.currency}</span>
        <input
          type="number"
          min={0}
          value={config[key] as number}
          onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Tier Pricing (Free / Gold / Platinum)</h2>
      <p className="text-xs text-gray-400 mb-4">
        Catalog prices for both the per-listing tier an ordinary user picks before posting, and the subscription tier a Registered Store manages from its dashboard.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
            <select
              value={config.currency}
              onChange={(e) => setConfig({ ...config, currency: e.target.value as TierPricingConfig['currency'] })}
              className="w-full sm:w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-800 mb-2">Per-listing tier (ordinary users)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {numberField('🥇 Gold price', 'listingGoldPrice')}
              {numberField('💎 Platinum price', 'listingPlatinumPrice')}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Duration (days)</label>
                <input
                  type="number"
                  min={1}
                  value={config.listingTierDurationDays}
                  onChange={(e) => setConfig({ ...config, listingTierDurationDays: Number(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <p className="text-[11px] text-gray-400 mt-0.5">How long Gold/Platinum lasts once confirmed.</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-800 mb-2">Store subscription (monthly)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {numberField('Free tier fee', 'storeFreeFee', 'Store Dashboard access, no premium visibility.')}
              {numberField('🥇 Gold tier fee', 'storeGoldFee')}
              {numberField('💎 Platinum tier fee', 'storePlatinumFee')}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">Annual plans bill 5× the monthly figure above.</p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {message && (
              <p className={`text-xs ${message.isError ? 'text-red-600' : 'text-green-600'}`}>{message.text}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
