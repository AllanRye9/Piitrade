'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

/**
 * Admin control for the AI Customer Support chat (Module 2): a single
 * free-text box of FAQ/policy content the chat is strictly restricted to
 * answering from. Empty means the chat always falls back to the
 * human-transfer message — there's no "off" switch separate from this,
 * since an empty context and a disabled chat behave identically from a
 * shopper's point of view.
 */
export default function SupportChatSettings() {
  const [context, setContext] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    api.get('/admin/site-config/support-faq')
      .then(({ data }) => setContext(data.supportFaqContext || ''))
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
      const { data } = await api.put('/admin/site-config/support-faq', { supportFaqContext: context });
      setContext(data.supportFaqContext || '');
      flash('Support chat FAQ saved');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save';
      flash(msg, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">AI Customer Support</h2>
      <p className="text-xs text-gray-400 mb-4">
        The floating support chat answers only from this text — paste in your FAQ, shipping/return policy, and platform rules. Anything not covered here gets a &quot;let me transfer you to a human agent&quot; reply instead of a guess.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-3">
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={12}
            placeholder={'Q: How do I return an item?\nA: Items can be returned within 7 days of delivery...\n\nQ: What payment methods do you accept?\nA: ...'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <div className="flex items-center gap-3">
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
