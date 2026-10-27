'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';
import HomeSectionsEditor from '@/components/admin/HomeSectionsEditor';
import PlacementAdder from '@/components/admin/PlacementAdder';

type Section = 'FLASH_SALE' | 'FEATURED_DEAL' | 'LATEST_COLLECTIONS' | 'BACK_TO_SCHOOL' | 'STORES';
type Tier = 'FREE' | 'GOLD' | 'PLATINUM';

interface Item {
  id: string;
  kind: 'listing' | 'store';
  title: string;
  image: string | null;
  tier: Tier;
  pinOrder: number | null;
  owner: string;
  price?: number | null;
  placementExpiresAt?: string | null;
  slug?: string;
}

const SECTIONS: { value: Section; label: string; icon: string; rule: string }[] = [
  { value: 'FLASH_SALE', label: 'Flash Deals', icon: '⚡', rule: 'Admin-placed flash listings. Pinned first, then most recently updated.' },
  { value: 'FEATURED_DEAL', label: 'Featured Deal', icon: '✦', rule: 'Listings placed as Featured Deal (admin or paying store). Pinned first, then most recently updated.' },
  { value: 'LATEST_COLLECTIONS', label: 'Latest Collections', icon: '⭐', rule: 'Placed listings plus every active Gold/Platinum listing. Pinned first, then Platinum → Gold, then most recently updated.' },
  { value: 'BACK_TO_SCHOOL', label: 'Back to School', icon: '🎒', rule: 'Listings placed in Back to School. Pinned first, then most recently updated.' },
  { value: 'STORES', label: 'Trusted Stores', icon: '🏪', rule: 'Web stores row and /stores. Pinned first, then by store plan (Platinum → Gold → Free), then newest.' },
];

const TIER_STYLE: Record<Tier, string> = {
  FREE: 'bg-gray-100 text-gray-600',
  GOLD: 'bg-amber-100 text-amber-800',
  PLATINUM: 'bg-slate-800 text-white',
};

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export default function AdminHomepageLayoutPage() {
  const [mode, setMode] = useState<'sections' | 'rows'>('sections');
  const [section, setSection] = useState<Section>('FEATURED_DEAL');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setDirty(false);
    api.get('/admin/homepage-layout', { params: { section } })
      .then(({ data }) => setItems(data.items ?? []))
      .catch((e) => { setItems([]); setNotice({ text: errMsg(e, 'Failed to load this section'), error: true }); })
      .finally(() => setLoading(false));
  }, [section]);

  useEffect(() => { setNotice(null); load(); }, [load]);

  const meta = SECTIONS.find((s) => s.value === section)!;

  const move = (index: number, to: number) => {
    if (to < 0 || to >= items.length || to === index) return;
    setItems((prev) => {
      const next = [...prev];
      const [it] = next.splice(index, 1);
      next.splice(to, 0, it);
      return next;
    });
    setDirty(true);
  };

  const saveOrder = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await api.put('/admin/homepage-layout/order', { section, ids: items.map((i) => i.id) });
      setNotice({ text: `Saved. These ${items.length} items are now pinned in this order.`, error: false });
      load();
    } catch (e) {
      setNotice({ text: errMsg(e, 'Failed to save order'), error: true });
    } finally {
      setSaving(false);
    }
  };

  const unpin = async (item: Item) => {
    setBusyId(item.id);
    setNotice(null);
    try {
      await api.put(item.kind === 'store' ? `/admin/stores/${item.id}/pin` : `/admin/listings/${item.id}/pin`, { pinOrder: null });
      load();
    } catch (e) {
      setNotice({ text: errMsg(e, 'Failed to unpin'), error: true });
    } finally {
      setBusyId(null);
    }
  };

  const changeTier = async (item: Item, tier: Tier) => {
    setBusyId(item.id);
    setNotice(null);
    try {
      await api.put(`/admin/listings/${item.id}/tier`, { tier });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, tier } : i)));
      setNotice({ text: `Tier updated. Reload to see the row re-sorted.`, error: false });
    } catch (e) {
      setNotice({ text: errMsg(e, 'Failed to change tier'), error: true });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 flex items-center gap-2"><span aria-hidden="true">🧩</span> Homepage Layout</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Choose which sections the homepage shows and in what order, then fill the rows with ads.
        </p>
      </div>

      <div className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1" role="tablist" aria-label="Homepage layout mode">
        {([['sections', 'Page sections'], ['rows', 'Ads in rows']] as const).map(([m, label]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>{label}</button>
        ))}
      </div>

      {mode === 'sections' ? <HomeSectionsEditor /> : (<>

      {/* Section tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
        {SECTIONS.map((s) => (
          <button
            key={s.value}
            role="tab"
            aria-selected={section === s.value}
            onClick={() => setSection(s.value)}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              section === s.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span aria-hidden="true">{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-800">
        <strong>How this row is ordered:</strong> {meta.rule}
      </div>

      {section !== 'STORES' && <PlacementAdder section={section} label={meta.label} onPlaced={load} />}

      {notice && (
        <p role="status" className={`text-sm rounded-lg px-3 py-2 border ${notice.error ? 'text-red-700 bg-red-50 border-red-100' : 'text-green-700 bg-green-50 border-green-100'}`}>{notice.text}</p>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-gray-100 bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">{loading ? 'Loading…' : `${items.length} item${items.length === 1 ? '' : 's'} (showing top 100)`}</p>
          <button
            onClick={saveOrder}
            disabled={!dirty || saving}
            className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-40"
          >
            {saving ? 'Saving…' : dirty ? 'Save order' : 'Saved'}
          </button>
        </div>

        {!loading && items.length === 0 && (
          <div className="p-10 text-center">
            <p className="text-3xl mb-1" aria-hidden="true">📭</p>
            <p className="text-sm font-semibold text-gray-700">Nothing in this row yet</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {section === 'STORES' ? 'No active stores.' : 'Place listings here from Admin → Listings (Approve / Mark Feature).'}
            </p>
          </div>
        )}

        <ol className="divide-y divide-gray-100">
          {items.map((item, i) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <span className="shrink-0 w-7 text-center text-sm font-bold text-gray-400">{i + 1}</span>
              <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-100">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveImageUrl(item.image)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300" aria-hidden="true">{item.kind === 'store' ? '🏪' : '🛍️'}</div>
                )}
              </div>
              <div className="min-w-0 flex-1 basis-[9rem]">
                <p className="text-sm font-semibold text-gray-900 sm:truncate">{item.title}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  {item.pinOrder !== null ? (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">📌 Pinned #{item.pinOrder}</span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Auto</span>
                  )}
                  {item.kind === 'listing' ? (
                    <select
                      value={item.tier}
                      onChange={(e) => changeTier(item, e.target.value as Tier)}
                      disabled={busyId === item.id}
                      aria-label={`Tier for ${item.title}`}
                      className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 border-0 ${TIER_STYLE[item.tier]}`}
                    >
                      <option value="FREE">Free</option>
                      <option value="GOLD">Gold</option>
                      <option value="PLATINUM">Platinum</option>
                    </select>
                  ) : (
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${TIER_STYLE[item.tier]}`} title="Set by the store's plan (Admin → Packages / Webstores)">{item.tier.toLowerCase()} plan</span>
                  )}
                  <span className="text-xs text-gray-400 truncate">{item.owner}</span>
                </div>
              </div>
              <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                <button onClick={() => move(i, 0)} disabled={i === 0} title="Move to top" aria-label="Move to top"
                  className="px-2 py-1 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30">Top</button>
                <button onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move up"
                  className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">↑</button>
                <button onClick={() => move(i, i + 1)} disabled={i === items.length - 1} aria-label="Move down"
                  className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">↓</button>
                {item.pinOrder !== null && (
                  <button onClick={() => unpin(item)} disabled={busyId === item.id} title="Remove pin"
                    className="px-2 py-1 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40">Unpin</button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-xs text-gray-500">
        Tip: <strong>Save order</strong> pins every item shown, in the order you arranged. Pins apply wherever that listing or store appears, including the main feed, so unpin items you no longer want pushed to the top.
      </p>
      </>)}
    </div>
  );
}
