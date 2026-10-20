'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface SpecialOffersConfig {
  enabled: boolean;
  minDiscountPercent: number;
  startAt: string | null;
  endAt: string | null;
}

const DEFAULT_CONFIG: SpecialOffersConfig = {
  enabled: true,
  minDiscountPercent: 30,
  startAt: null,
  endAt: null,
};

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
        enabled ? 'bg-red-600' : 'bg-gray-300'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

/**
 * Admin control for "Special Offers": the on/off switch, the minimum discount a
 * listing's "was" price must give to appear, and an optional scheduled window.
 * Which listings qualify is automatic (original price vs selling price); this
 * panel only sets the rules. The public site reads these values through
 * GET /api/public/site-config and the offers listing endpoint.
 */
export default function SpecialOffersSettings() {
  const [config, setConfig] = useState<SpecialOffersConfig>(DEFAULT_CONFIG);
  const [discountInput, setDiscountInput] = useState('30');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    api.get('/admin/site-config/special-offers')
      .then(({ data }) => {
        const next = { ...DEFAULT_CONFIG, ...data };
        setConfig(next);
        setDiscountInput(String(next.minDiscountPercent));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const flash = useCallback((text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const save = async (next: SpecialOffersConfig) => {
    setSaving(true);
    try {
      const { data } = await api.put('/admin/site-config/special-offers', next);
      const saved = { ...DEFAULT_CONFIG, ...data };
      setConfig(saved);
      setDiscountInput(String(saved.minDiscountPercent));
      flash('Special Offers settings saved');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save Special Offers settings';
      flash(msg, true);
    } finally {
      setSaving(false);
    }
  };

  const commitDiscount = () => {
    const n = Number(discountInput);
    if (!Number.isFinite(n) || n < 1 || n > 99) {
      flash('Minimum discount must be a number between 1 and 99', true);
      setDiscountInput(String(config.minDiscountPercent));
      return;
    }
    if (n !== config.minDiscountPercent) save({ ...config, minDiscountPercent: Math.round(n) });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Special Offers</h2>
      <p className="text-xs text-gray-400 mb-4">
        Listings appear automatically when their original price is higher than the selling price by at least the minimum discount below.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Enable Special Offers</p>
              <p className="text-xs text-gray-400">Off hides the section, page and mobile popup everywhere.</p>
            </div>
            <ToggleSwitch enabled={config.enabled} onChange={(v) => { const next = { ...config, enabled: v }; setConfig(next); save(next); }} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Minimum discount (%)</label>
            <input
              type="number"
              min={1}
              max={99}
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              onBlur={commitDiscount}
              className="w-full sm:w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Starts (optional)</label>
              <input
                type="datetime-local"
                value={isoToLocalInput(config.startAt)}
                onChange={(e) => setConfig({ ...config, startAt: localInputToIso(e.target.value) })}
                onBlur={() => save(config)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ends (optional)</label>
              <input
                type="datetime-local"
                value={isoToLocalInput(config.endAt)}
                onChange={(e) => setConfig({ ...config, endAt: localInputToIso(e.target.value) })}
                onBlur={() => save(config)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 -mt-2">Leave both blank to run indefinitely while enabled above.</p>

          {saving && <p className="text-xs text-gray-400">Saving…</p>}
          {message && (
            <p className={`text-xs ${message.isError ? 'text-red-600' : 'text-green-600'}`}>{message.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
