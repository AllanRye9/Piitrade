'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Category } from '@/lib/types';

type Placement = 'LATEST_COLLECTIONS' | 'FEATURED_DEAL' | 'FLASH_SALE' | 'BACK_TO_SCHOOL';
type Source = { type: 'category'; slug: string } | { type: 'placement'; placement: Placement } | { type: 'listings'; ids: string[] };
interface Collection { id: string; title: string; subtitle: string; icon: string; enabled: boolean; limit: number; source: Source }
interface Setting { enabled: boolean; title?: string; subtitle?: string }
interface Layout { order: string[]; settings: Record<string, Setting>; collections: Collection[] }
interface BuiltIn { key: string; label: string; description: string; icon: string; canRename: boolean }
interface ConfigResponse { layout: Layout; builtIns: BuiltIn[]; limits: { collections: number; items: number } }
interface ListingHit { id: string; title: string; price?: number | null; status: string; images?: string[] }

const PLACEMENT_LABEL: Record<Placement, string> = {
  FLASH_SALE: 'Flash Deals', FEATURED_DEAL: 'Featured Deal', LATEST_COLLECTIONS: 'Latest Collections', BACK_TO_SCHOOL: 'Back to School',
};
const errMsg = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

export default function HomeSectionsEditor() {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [cats, setCats] = useState<{ slug: string; label: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<ConfigResponse>('/admin/home-layout/config')
      .then(({ data }) => { setCfg(data); setLayout(data.layout); setDirty(false); })
      .catch((e) => setNotice({ text: errMsg(e, 'Failed to load the homepage layout'), error: true }));
  }, []);
  useEffect(() => {
    load();
    api.get<Category[]>('/categories').then(({ data }) => {
      setCats(data.flatMap((c) => [{ slug: c.slug, label: c.name }, ...(c.children ?? []).map((k) => ({ slug: k.slug, label: `${c.name} › ${k.name}` }))]));
    }).catch(() => {});
  }, [load]);

  const builtInByKey = useMemo(() => new Map((cfg?.builtIns ?? []).map((b) => [b.key, b])), [cfg]);
  if (!layout || !cfg) return <p className="p-6 text-sm text-gray-500">{notice?.text ?? 'Loading…'}</p>;

  const change = (next: Layout) => { setLayout(next); setDirty(true); setNotice(null); };
  const move = (i: number, to: number) => {
    if (to < 0 || to >= layout.order.length) return;
    const order = [...layout.order];
    const [k] = order.splice(i, 1);
    order.splice(to, 0, k);
    change({ ...layout, order });
  };
  const setSetting = (key: string, patch: Partial<Setting>) =>
    change({ ...layout, settings: { ...layout.settings, [key]: { ...layout.settings[key], enabled: layout.settings[key]?.enabled !== false, ...patch } } });
  const setCollection = (id: string, patch: Partial<Collection>) =>
    change({ ...layout, collections: layout.collections.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addCollection = () => {
    if (layout.collections.length >= cfg.limits.collections) return;
    const id = newId();
    const c: Collection = { id, title: 'New collection', subtitle: '', icon: '✨', enabled: true, limit: 12, source: { type: 'placement', placement: 'LATEST_COLLECTIONS' } };
    change({ ...layout, collections: [...layout.collections, c], order: [...layout.order, `custom:${id}`] });
    setEditing(`custom:${id}`);
  };
  const removeCollection = (id: string) => {
    if (!window.confirm('Delete this collection row?')) return;
    change({ ...layout, collections: layout.collections.filter((c) => c.id !== id), order: layout.order.filter((k) => k !== `custom:${id}`) });
  };

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      const { data } = await api.put<{ layout: Layout }>('/admin/home-layout/config', layout);
      setLayout(data.layout); setDirty(false);
      setNotice({ text: 'Saved. The homepage updates within about 30 seconds.', error: false });
    } catch (e) {
      setNotice({ text: errMsg(e, 'Failed to save'), error: true });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">Top to bottom is the order visitors see. Hide a section, rename it, or add your own rows of ads.</p>
        <div className="flex gap-2">
          <button onClick={addCollection} disabled={layout.collections.length >= cfg.limits.collections}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">+ Add collection row</button>
          <button onClick={save} disabled={!dirty || saving} className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
            {saving ? 'Saving…' : dirty ? 'Save layout' : 'Saved'}
          </button>
        </div>
      </div>
      {notice && <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.error ? 'border-red-100 bg-red-50 text-red-700' : 'border-green-100 bg-green-50 text-green-700'}`}>{notice.text}</p>}

      <ol className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {layout.order.map((key, i) => {
          const custom = key.startsWith('custom:');
          const b = custom ? null : builtInByKey.get(key);
          const col = custom ? layout.collections.find((c) => `custom:${c.id}` === key) : null;
          if (!b && !col) return null;
          const enabled = col ? col.enabled : layout.settings[key]?.enabled !== false;
          const title = col ? col.title : (layout.settings[key]?.title || b!.label);
          const open = editing === key;
          return (
            <li key={key} className={enabled ? '' : 'bg-gray-50'}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2.5">
                <span className="w-6 shrink-0 text-center text-sm font-bold text-gray-400">{i + 1}</span>
                <span className="shrink-0 text-xl" aria-hidden="true">{col ? col.icon : b!.icon}</span>
                <div className="min-w-0 flex-1 basis-[10rem]">
                  <p className={`text-sm font-semibold ${enabled ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                    {title}{col && <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-violet-700 no-underline">Custom</span>}
                  </p>
                  <p className="text-xs text-gray-500">{col ? describeSource(col.source, cats) : b!.description}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-semibold text-gray-600">
                  <input type="checkbox" checked={enabled} onChange={(e) => (col ? setCollection(col.id, { enabled: e.target.checked }) : setSetting(key, { enabled: e.target.checked }))} className="h-4 w-4 accent-red-600" />
                  <span className="hidden sm:inline">Show</span>
                </label>
                {(col || b?.canRename) && (
                  <button onClick={() => setEditing(open ? null : key)} aria-expanded={open} className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50">{open ? 'Done' : 'Edit'}</button>
                )}
                <button onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up" className="h-8 w-8 shrink-0 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">↑</button>
                <button onClick={() => move(i, i + 1)} disabled={i === layout.order.length - 1} aria-label="Move down" className="h-8 w-8 shrink-0 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">↓</button>
              </div>

              {open && b && (
                <div className="grid gap-2 border-t border-gray-100 bg-gray-50 px-3 py-3 sm:grid-cols-2">
                  <Text label="Heading" value={layout.settings[key]?.title ?? ''} placeholder={b.label} onChange={(v) => setSetting(key, { title: v })} max={60} />
                  <Text label="Sub-heading" value={layout.settings[key]?.subtitle ?? ''} placeholder="Leave empty for the default" onChange={(v) => setSetting(key, { subtitle: v })} max={120} />
                </div>
              )}
              {open && col && (
                <div className="grid gap-2 border-t border-gray-100 bg-gray-50 px-3 py-3 sm:grid-cols-2">
                  <Text label="Heading" value={col.title} onChange={(v) => setCollection(col.id, { title: v })} max={60} />
                  <Text label="Sub-heading" value={col.subtitle} onChange={(v) => setCollection(col.id, { subtitle: v })} max={120} />
                  <Text label="Icon (emoji)" value={col.icon} onChange={(v) => setCollection(col.id, { icon: v })} max={4} />
                  <label className="block text-xs font-medium text-gray-700">Ads shown (2–{cfg.limits.items})
                    <input type="number" min={2} max={cfg.limits.items} value={col.limit} onChange={(e) => setCollection(col.id, { limit: Math.min(cfg.limits.items, Math.max(2, Number(e.target.value) || 12)) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="block text-xs font-medium text-gray-700 sm:col-span-2">Where the ads come from
                    <select
                      value={col.source.type === 'category' ? `cat:${col.source.slug}` : col.source.type === 'placement' ? `pl:${col.source.placement}` : 'picked'}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCollection(col.id, { source: v.startsWith('cat:') ? { type: 'category', slug: v.slice(4) } : v.startsWith('pl:') ? { type: 'placement', placement: v.slice(3) as Placement } : { type: 'listings', ids: col.source.type === 'listings' ? col.source.ids : [] } });
                      }}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      <optgroup label="Newest ads in a category">
                        {cats.map((c) => <option key={c.slug} value={`cat:${c.slug}`}>{c.label}</option>)}
                      </optgroup>
                      <optgroup label="Ads placed in a row (Admin → Listings, or the Add ads tab)">
                        {(Object.keys(PLACEMENT_LABEL) as Placement[]).map((p) => <option key={p} value={`pl:${p}`}>{PLACEMENT_LABEL[p]} placement</option>)}
                      </optgroup>
                      <optgroup label="Hand-picked"><option value="picked">Hand-picked ads (paste listing IDs)</option></optgroup>
                    </select>
                  </label>
                  {col.source.type === 'listings' && (
                    <label className="block text-xs font-medium text-gray-700 sm:col-span-2">Listing IDs, one per line, in display order
                      <textarea rows={4} value={col.source.ids.join('\n')} onChange={(e) => setCollection(col.id, { source: { type: 'listings', ids: e.target.value.split(/[\s,]+/).filter(Boolean).slice(0, cfg.limits.items) } })}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs" />
                    </label>
                  )}
                  <div className="sm:col-span-2">
                    <button onClick={() => removeCollection(col.id)} className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Delete this row</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-gray-500">Rows with no ads (or outside their schedule) are skipped automatically, so hiding is only needed when you want a section off even if it has ads.</p>
    </div>
  );
}

function describeSource(s: Source, cats: { slug: string; label: string }[]): string {
  if (s.type === 'category') return `Newest in ${cats.find((c) => c.slug === s.slug)?.label ?? s.slug}`;
  if (s.type === 'placement') return `Ads placed in ${PLACEMENT_LABEL[s.placement]}`;
  return `${s.ids.length} hand-picked ad${s.ids.length === 1 ? '' : 's'}`;
}

function Text({ label, value, onChange, placeholder, max }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; max: number }) {
  return (
    <label className="block text-xs font-medium text-gray-700">{label}
      <input value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
    </label>
  );
}
