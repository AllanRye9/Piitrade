'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface BlogPostOption {
  id: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED';
}

interface BlogPopupConfig {
  enabled: boolean;
  intervalSeconds: number;
  postId: string | null;
}

const DEFAULT_CONFIG: BlogPopupConfig = {
  enabled: false,
  intervalSeconds: 60,
  postId: null,
};

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
 * Admin control for the homepage blog popup: on/off, how often it
 * re-appears (in seconds), and which post it shows. Leaving the post
 * unselected ("Most recently published") means the popup always tracks
 * whatever is newest — the common case — without needing to be re-pointed
 * every time a new post goes live.
 */
export default function BlogPopupSettings() {
  const [config, setConfig] = useState<BlogPopupConfig>(DEFAULT_CONFIG);
  const [posts, setPosts] = useState<BlogPostOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    Promise.allSettled([
      api.get('/admin/site-config/blog-popup'),
      api.get('/blog/admin/all'),
    ]).then(([configResult, postsResult]) => {
      if (configResult.status === 'fulfilled') {
        setConfig({ ...DEFAULT_CONFIG, ...configResult.value.data });
      }
      if (postsResult.status === 'fulfilled') {
        setPosts(postsResult.value.data?.posts || []);
      }
      setLoading(false);
    });
  }, []);

  const flash = useCallback((text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 3500);
  }, []);

  const save = async (next: BlogPopupConfig) => {
    setSaving(true);
    try {
      const { data } = await api.put('/admin/site-config/blog-popup', next);
      setConfig({ ...DEFAULT_CONFIG, ...data });
      flash('Blog popup settings saved');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save blog popup settings';
      flash(msg, true);
    } finally {
      setSaving(false);
    }
  };

  const publishedPosts = posts.filter((p) => p.status === 'PUBLISHED');

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Homepage Blog Popup</h2>
      <p className="text-xs text-gray-400 mb-4">
        Shows a blog post in a dismissible popup on the homepage, re-appearing on the interval below for as long as a shopper stays on the page.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Enable popup</p>
              <p className="text-xs text-gray-400">Off hides it entirely — nothing renders on the homepage.</p>
            </div>
            <ToggleSwitch enabled={config.enabled} onChange={(v) => { const next = { ...config, enabled: v }; setConfig(next); save(next); }} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Repeat interval (seconds)</label>
            <input
              type="number"
              min={10}
              value={config.intervalSeconds}
              onChange={(e) => setConfig({ ...config, intervalSeconds: Number(e.target.value) })}
              onBlur={() => save(config)}
              className="w-full sm:w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="text-xs text-gray-400 mt-1">Minimum 10 seconds. The popup first appears after this many seconds on the page, then again each time it elapses if the shopper dismissed it.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Post to feature</label>
            <select
              value={config.postId ?? ''}
              onChange={(e) => { const next = { ...config, postId: e.target.value || null }; setConfig(next); save(next); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">Most recently published</option>
              {publishedPosts.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            {publishedPosts.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No published posts yet — publish one from the Blog admin section before turning this on.</p>
            )}
          </div>

          {saving && <p className="text-xs text-gray-400">Saving…</p>}
          {message && (
            <p className={`text-xs ${message.isError ? 'text-red-600' : 'text-green-600'}`}>{message.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
