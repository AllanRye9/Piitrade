'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

type Section = 'FLASH_SALE' | 'FEATURED_DEAL' | 'LATEST_COLLECTIONS' | 'BACK_TO_SCHOOL';
interface Hit { id: string; title: string; price?: number | null; currency?: string; images?: string[]; productImages?: { cdnUrl: string | null }[]; placement?: string; user?: { name?: string } }

const DURATIONS = [
  { days: 7, label: '7 days' }, { days: 14, label: '14 days' }, { days: 30, label: '30 days' }, { days: 60, label: '60 days' }, { days: 90, label: '90 days' },
];
const errMsg = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

/** Search live ads and put them into a homepage row (Flash Deals, Featured Deal, Latest Collections, Back to School). */
export default function PlacementAdder({ section, label, onPlaced }: { section: Section; label: string; onPlaced: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      api.get('/admin/listings', { params: { search: term, status: 'ACTIVE', limit: 8 } })
        .then(({ data }) => { if (mine === seq.current) setHits(data.listings ?? []); })
        .catch(() => { if (mine === seq.current) setHits([]); })
        .finally(() => { if (mine === seq.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const place = async (hit: Hit) => {
    setBusy(hit.id); setMsg(null);
    try {
      await api.put(`/admin/listings/${hit.id}`, { placement: section, placementExpiresAt: new Date(Date.now() + days * 86_400_000).toISOString() });
      setMsg({ text: `"${hit.title}" is now in ${label} for ${days} days.`, error: false });
      setHits((prev) => prev.map((h) => (h.id === hit.id ? { ...h, placement: section } : h)));
      onPlaced();
    } catch (e) {
      setMsg({ text: errMsg(e, 'Could not place this ad'), error: true });
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-xs font-medium text-gray-700">Add an ad to {label}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search live ads by title or description…" className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" />
        </label>
        <label className="text-xs font-medium text-gray-700">Stay for
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 h-10 rounded-lg border border-gray-300 px-2 text-sm">
            {DURATIONS.map((d) => <option key={d.days} value={d.days}>{d.label}</option>)}
          </select>
        </label>
      </div>
      {msg && <p role="status" className={`mb-2 rounded-lg border px-3 py-1.5 text-xs ${msg.error ? 'border-red-100 bg-red-50 text-red-700' : 'border-green-100 bg-green-50 text-green-700'}`}>{msg.text}</p>}
      {searching && <p className="text-xs text-gray-400">Searching…</p>}
      {!searching && q.trim().length >= 2 && hits.length === 0 && <p className="text-xs text-gray-500">No live ads match “{q.trim()}”. Only active ads can be placed.</p>}
      <ul className="divide-y divide-gray-100">
        {hits.map((h) => (
          <li key={h.id} className="flex items-center gap-2.5 py-2">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-100">
              {(h.productImages?.[0]?.cdnUrl || h.images?.[0]) && ( // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveImageUrl((h.productImages?.[0]?.cdnUrl || h.images?.[0]) as string)} alt="" loading="lazy" className="h-full w-full object-cover" />)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{h.title}</p>
              <p className="truncate text-xs text-gray-500">{h.user?.name ?? ''}{h.price != null ? ` · ${Number(h.price).toLocaleString('en-US')} ${h.currency ?? 'UGX'}` : ''}{h.placement && h.placement !== 'NONE' ? ` · now in ${h.placement.replace(/_/g, ' ').toLowerCase()}` : ''}</p>
            </div>
            <button onClick={() => place(h)} disabled={busy === h.id || h.placement === section}
              className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40">
              {h.placement === section ? 'In row' : busy === h.id ? 'Adding…' : 'Add'}
            </button>
          </li>
        ))}
      </ul>
      {section === 'FLASH_SALE' && <p className="mt-2 text-[11px] text-gray-500">Flash Deals hold up to 100 ads at once.</p>}
    </div>
  );
}
