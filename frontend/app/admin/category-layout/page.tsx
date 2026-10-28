'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import { useCategoryCounts } from '@/hooks/useCategoryCounts';
import { formatCount } from '@/lib/formatCount';
import { UNGATED_TREES } from '@/lib/categoryVisibility';
import { defaultOrder, initialOrder, moveItem, moveToTop, sameLayout } from '@/components/admin/categoryLayoutModel';
import type { Category } from '@/lib/types';

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export default function AdminCategoryLayoutPage() {
  const { country } = useCountry();
  const { counts } = useCategoryCounts(country);
  const [tree, setTree] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [saved, setSaved] = useState<{ order: string[]; hidden: string[] }>({ order: [], hidden: [] });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get('/categories'), api.get('/admin/settings')])
      .then(([cats, settings]) => {
        if (cancelled) return;
        const parents: Category[] = Array.isArray(cats.data) ? cats.data : [];
        const slugs = parents.map((c) => c.slug);
        const savedRank: string[] = settings.data?.categoryRank ?? [];
        const savedHidden: string[] = (settings.data?.hiddenCategories ?? []).filter((s: string) => slugs.includes(s));
        const start = initialOrder(slugs, savedRank);
        setTree(parents);
        setOrder(start);
        setHidden(savedHidden);
        setSaved({ order: start, hidden: savedHidden });
      })
      .catch((e) => { if (!cancelled) setNotice({ text: errMsg(e, 'Failed to load categories'), error: true }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const bySlug = useMemo(() => new Map(tree.map((c) => [c.slug, c])), [tree]);
  const dirty = !sameLayout({ order, hidden }, saved);

  const toggleHidden = (slug: string) =>
    setHidden((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await api.put('/admin/settings', { categoryRank: order, hiddenCategories: hidden });
      setSaved({ order, hidden });
      setNotice({ text: 'Saved. Buyers see the new order within about a minute.', error: false });
    } catch (e) {
      setNotice({ text: errMsg(e, 'Failed to save'), error: true });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setOrder(defaultOrder(tree.map((c) => c.slug)));
    setHidden([]);
    setNotice(null);
  };

  const liveVisible = order.filter((s) => !hidden.includes(s) && (UNGATED_TREES.has(s) || (counts?.[s] ?? 0) > 0)).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-gray-900 sm:text-2xl"><span aria-hidden="true">🗂️</span> Category layout</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Choose the order of top-level categories in the header, home tiles, search and filters, and hide any you don&apos;t want buyers to see.
          Categories with no listings are hidden from buyers automatically. Sellers still see every category when posting.
          To add or rename categories use <Link href="/admin/categories" className="text-red-600 hover:underline">Categories</Link>.
        </p>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        <strong>How it works:</strong> the first categories in this list that have listings fill the header tabs and home tiles (the rest go under
        &ldquo;More&rdquo; and <Link href="/categories" className="underline">/categories</Link>). Anything you don&apos;t reorder keeps the default order after the ones you do.
      </div>

      {notice && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.error ? 'border-red-100 bg-red-50 text-red-700' : 'border-green-100 bg-green-50 text-green-700'}`}>{notice.text}</p>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-gray-700">
            {loading ? 'Loading…' : `${order.length} categories · ${liveVisible} visible to buyers now`}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} disabled={loading || saving} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              Reset to default
            </button>
            <button type="button" onClick={save} disabled={!dirty || saving} className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
              {saving ? 'Saving…' : dirty ? 'Save layout' : 'Saved'}
            </button>
          </div>
        </div>

        <ol className="divide-y divide-gray-100">
          {order.map((slug, i) => {
            const cat = bySlug.get(slug);
            if (!cat) return null;
            const n = counts?.[slug] ?? 0;
            const isHidden = hidden.includes(slug);
            return (
              <li key={slug} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${isHidden ? 'bg-gray-50 opacity-70' : ''}`}>
                <span className="w-7 shrink-0 text-center text-sm font-bold text-gray-400">{i + 1}</span>
                <span className="text-xl" aria-hidden="true">{cat.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{cat.name}</p>
                  <p className="text-xs text-gray-500">
                    {counts == null ? '' : n > 0 ? `${formatCount(n)} listings` : UNGATED_TREES.has(slug) ? 'Not listing-driven' : 'No listings yet · hidden from buyers automatically'}
                    {cat.children?.length ? ` · ${cat.children.length} subcategories` : ''}
                  </p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-600">
                  <input type="checkbox" checked={isHidden} onChange={() => toggleHidden(slug)} aria-label={`Hide ${cat.name} from buyers`} />
                  Hide from buyers
                </label>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setOrder((o) => moveToTop(o, slug))} disabled={i === 0} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30" aria-label={`Move ${cat.name} to the top`}>Top</button>
                  <button type="button" onClick={() => setOrder((o) => moveItem(o, slug, -1))} disabled={i === 0} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30" aria-label={`Move ${cat.name} up`}>▲</button>
                  <button type="button" onClick={() => setOrder((o) => moveItem(o, slug, 1))} disabled={i === order.length - 1} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30" aria-label={`Move ${cat.name} down`}>▼</button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
