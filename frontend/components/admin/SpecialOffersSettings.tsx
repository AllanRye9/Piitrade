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
  enabled: false,
  minDiscountPercent: 30,
  startAt: null,
  endAt: null,
};

// <input type="datetime-local"> needs "YYYY-MM-DDTHH:mm" with no timezone
// suffix; the API stores/returns full ISO strings. These two converters
// keep the two representations from ever being compared or sent to each
// other directly.
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
 * Admin control for the "Special Offers" section (formerly "Special
 * Finds"): on/off, the minimum discount percentage a listing needs to
 * qualify, and an optional scheduled window. Content itself isn't managed
 * here — it's the existing Flash Sale placement pool (Admin → Listings),
 * filtered by the threshold below; this panel only controls the section's
 * visibility, timing, and cutoff.
 */
export default function SpecialOffersSettings() {
  const [config, setConfig] = useState<SpecialOffersConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    api.get('/admin/site-config/special-offers')
      .then(({ data }) => setConfig({ ...DEFAULT_CONFIG, ...data }))
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
      setConfig({ ...DEFAULT_CONFIG, ...data });
      flash('Special Offers settings saved');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save Special Offers settings';
      flash(msg, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Special Offers</h2>
      <p className="text-xs text-gray-400 mb-4">
        The mobile floating popup and highlighted-deals section. Listings qualify by discount percentage; content itself is managed from Admin → Listings by placing items on Flash Sale.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Enable section</p>
              <p className="text-xs text-gray-400">Off hides the popup and its floating icon entirely.</p>
            </div>
            <ToggleSwitch enabled={config.enabled} onChange={(v) => { const next = { ...config, enabled: v }; setConfig(next); save(next); }} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Minimum discount to qualify (%)</label>
            <input
              type="number"
              min={1}
              max={95}
              value={config.minDiscountPercent}
              onChange={(e) => setConfig({ ...config, minDiscountPercent: Number(e.target.value) })}
              onBlur={() => save(config)}
              className="w-full sm:w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="text-xs text-gray-400 mt-1">A Flash Sale listing needs at least this much off (price vs. original price) to appear here.</p>
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
