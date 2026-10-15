'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface BackToSchoolConfig {
  enabled: boolean;
  startAt: string | null;
  endAt: string | null;
}

const DEFAULT_CONFIG: BackToSchoolConfig = {
  enabled: false,
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
 * Admin control for the "Back to School" homepage section: on/off and an
 * optional scheduled window. Which listings appear is managed separately,
 * from Admin → Listings, by setting a listing's placement to "Back to
 * School" (same mechanism as Flash Sale / Featured Deal / Latest
 * Collections) — this panel only controls the section's own visibility and
 * timing, independent of any individual listing's own expiry.
 */
export default function BackToSchoolSettings() {
  const [config, setConfig] = useState<BackToSchoolConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    api.get('/admin/site-config/back-to-school')
      .then(({ data }) => setConfig({ ...DEFAULT_CONFIG, ...data }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const flash = useCallback((text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const save = async (next: BackToSchoolConfig) => {
    setSaving(true);
    try {
      const { data } = await api.put('/admin/site-config/back-to-school', next);
      setConfig({ ...DEFAULT_CONFIG, ...data });
      flash('Back to School settings saved');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save Back to School settings';
      flash(msg, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Back to School</h2>
      <p className="text-xs text-gray-400 mb-4">
        Homepage section and popup highlight. To add items, open a listing in Admin → Listings and set its placement to &quot;Back to School&quot;.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Enable section</p>
              <p className="text-xs text-gray-400">Off hides the section everywhere, even if listings are assigned to it.</p>
            </div>
            <ToggleSwitch enabled={config.enabled} onChange={(v) => { const next = { ...config, enabled: v }; setConfig(next); save(next); }} />
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
