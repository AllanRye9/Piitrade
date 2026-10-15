'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

type MarketplaceMode = 'CLASSIFIEDS' | 'ECOMMERCE' | 'HYBRID';

const MODES: { id: MarketplaceMode; title: string; tagline: string; detail: string }[] = [
  {
    id: 'CLASSIFIEDS',
    title: 'Classifieds',
    tagline: 'Like jiji.ug',
    detail: 'No Buy Now or cart anywhere. Every listing — including admin\u2019s — is contact-the-seller-only.',
  },
  {
    id: 'ECOMMERCE',
    title: 'E-commerce',
    tagline: 'Like jumia.ug',
    detail: 'Every listing gets Buy Now and cart. Motors and Property stay contact-only regardless \u2014 a car or a house isn\u2019t an instant-cart purchase.',
  },
  {
    id: 'HYBRID',
    title: 'Hybrid',
    tagline: 'Default \u2014 current behavior',
    detail: 'Only admin-owned listings get Buy Now, cart, and order tracking. Every other seller\u2019s listings are contact-only, like a classifieds board.',
  },
];

/**
 * Admin control for the site-wide Classifieds / E-commerce / Hybrid switch
 * — see isCheckoutEligible() in lib/utils.ts (what the whole frontend reads
 * this through) and POST /api/orders (the server-side enforcement that
 * makes this a real guarantee, not just a hidden button).
 */
export default function MarketplaceModeSettings() {
  const [mode, setMode] = useState<MarketplaceMode>('HYBRID');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    api.get('/admin/site-config/marketplace-mode')
      .then(({ data }) => setMode(data.marketplaceMode || 'HYBRID'))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const flash = useCallback((text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  const selectMode = async (next: MarketplaceMode) => {
    if (next === mode) return;
    const prev = mode;
    setMode(next);
    setSaving(true);
    try {
      await api.put('/admin/site-config/marketplace-mode', { marketplaceMode: next });
      flash(`Switched to ${MODES.find((m) => m.id === next)?.title}`);
    } catch (err) {
      setMode(prev);
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save';
      flash(msg, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Marketplace Mode</h2>
      <p className="text-xs text-gray-400 mb-4">
        Switches whether Buy Now / cart is available at all, and for whom. Applies site-wide immediately — enforced on the backend, not just hidden in the UI.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => selectMode(m.id)}
                disabled={saving}
                className={`text-left rounded-xl border-2 p-3 transition-colors disabled:opacity-60 ${
                  mode === m.id ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-900">{m.title}</p>
                  {mode === m.id && <span className="text-[10px] font-bold text-red-600 uppercase">Active</span>}
                </div>
                <p className="text-[11px] text-gray-400 mb-1">{m.tagline}</p>
                <p className="text-xs text-gray-600">{m.detail}</p>
              </button>
            ))}
          </div>
          {message && (
            <p className={`text-xs ${message.isError ? 'text-red-600' : 'text-green-600'}`}>{message.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
