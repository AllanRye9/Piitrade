'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCountry } from '@/context/CountryContext';
import { useTr } from '@/lib/i18n/useTr';
import { REGION_ORDER, useLocationDirectory, type RegionCount, type UgandaRegion } from '@/lib/useLocationDirectory';

const fmt = (n: number) => n.toLocaleString('en-US');
const SUFFIX = ' Region';

function regionOf(value: string, regions: RegionCount[]): UgandaRegion | null {
  if (!value) return null;
  const v = value.toLowerCase();
  return regions.find((r) => r.label.toLowerCase() === v)?.region ?? regions.find((r) => r.districts.some((d) => d.name.toLowerCase() === v))?.region ?? null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  value: string;
  onSelect: (value: string) => void;
  /** The button that opened it; the panel hangs from it. */
  anchor: HTMLElement | null;
}

/**
 * Phone version of the location picker: a small panel that hangs from the button that opened it, like a normal
 * dropdown. No dimmed backdrop, no page scroll-lock, no sheet sliding over the screen; the page stays where it is
 * and the panel closes when you pick, tap elsewhere or scroll the page. Regions are an accordion (tap Northern to
 * see its districts), so one short list is on screen at a time.
 */
export default function LocationDropdown({ open, onClose, value, onSelect, anchor }: Props) {
  const tr = useTr();
  const { locations } = useCountry();
  const { data, error, loading } = useLocationDirectory(open);
  const [expanded, setExpanded] = useState<UgandaRegion | null>(null);
  const [query, setQuery] = useState('');
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const regions = useMemo(() => data?.regions ?? [], [data]);
  const byRegion = useMemo(() => new Map(regions.map((r) => [r.region, r])), [regions]);

  useEffect(() => { if (open) setQuery(''); }, [open]);
  useEffect(() => {
    if (!open || regions.length === 0) return;
    setExpanded(regionOf(value, regions) ?? [...regions].sort((a, b) => b.total - a.total)[0]?.region ?? null);
  }, [open, regions, value]);

  // Hang the panel from the button: below it when there is room, above it when there is not.
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth; const vh = window.innerHeight;
      const width = Math.min(352, vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      const below = vh - r.bottom - 12; const above = r.top - 12;
      if (below >= 280 || below >= above) setBox({ left, width, top: r.bottom + 6, maxHeight: Math.max(200, Math.min(440, below)) });
      else setBox({ left, width, bottom: vh - r.top + 6, maxHeight: Math.max(200, Math.min(440, above)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor]);

  // Close on Escape, on a tap outside, and when the page itself scrolls (scrolling the list does not count).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose, anchor]);

  if (!open || !box || typeof document === 'undefined') return null;

  const pick = (v: string) => { onSelect(v); onClose(); };
  const q = query.trim().toLowerCase();
  const hits = q ? regions.flatMap((r) => r.districts.filter((d) => d.name.toLowerCase().includes(q)).map((d) => ({ ...d, region: r.region }))) : [];

  const row = (label: string, count: number | null, selected: boolean, sub?: string, key?: string) => (
    <button
      key={key ?? label}
      type="button"
      onClick={() => pick(label)}
      aria-pressed={selected}
      className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected ? 'bg-red-600 font-bold text-white' : 'text-gray-800 active:bg-red-50'}`}
    >
      <span className="min-w-0 truncate">{label}{sub && <span className={`ml-1 text-[11px] font-medium ${selected ? 'text-red-100' : 'text-gray-400'}`}>{sub}</span>}</span>
      {count !== null && <span className={`shrink-0 text-[11px] font-bold tabular-nums ${selected ? 'text-white/80' : 'text-gray-400'}`}>{fmt(count)}</span>}
    </button>
  );

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={tr('Choose location')}
      style={{ left: box.left, width: box.width, maxHeight: box.maxHeight, ...(box.top !== undefined ? { top: box.top } : { bottom: box.bottom }) }}
      className="fixed z-[95] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('Search district or town')}
          aria-label={tr('Search district or town')}
          className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm focus:border-red-400 focus:bg-white focus:outline-none"
        />
        <button type="button" onClick={onClose} aria-label={tr('Close')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-gray-500 active:bg-gray-100">×</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
        {loading && <div className="space-y-1 p-1" aria-busy="true">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-gray-100" />)}</div>}

        {error && !data && (
          <div>
            <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">{tr('Popular towns')}</p>
            {locations.filter((l) => !q || l.toLowerCase().includes(q)).map((l) => row(l, null, value === l))}
          </div>
        )}

        {data && regions.length === 0 && <p className="py-8 text-center text-sm text-gray-500">{tr('No listings yet')}</p>}

        {data && regions.length > 0 && q && (
          hits.length === 0
            ? <p className="py-8 text-center text-sm text-gray-500">{tr('No districts match')}</p>
            : hits.map((d) => row(d.name, d.count, value === d.name, d.region, d.name + d.region))
        )}

        {data && regions.length > 0 && !q && (
          <>
            {row(tr('All Locations'), data.total, !value, tr('Whole of Uganda'), 'all')}
            {REGION_ORDER.map((r) => {
              const info = byRegion.get(r);
              if (!info) return null;
              const on = expanded === r;
              return (
                <div key={r} className="border-t border-gray-100">
                  <button
                    type="button"
                    aria-expanded={on}
                    onClick={() => setExpanded(on ? null : r)}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold text-gray-900 active:bg-gray-50"
                  >
                    <span>{tr(r)}</span>
                    <span className="flex items-center gap-2 text-[11px] font-bold tabular-nums text-gray-400">
                      {fmt(info.total)}
                      <span aria-hidden className={`text-xs transition-transform ${on ? 'rotate-180' : ''}`}>▾</span>
                    </span>
                  </button>
                  {on && (
                    <div className="pb-1 pl-3">
                      {row(`${r}${SUFFIX}`, info.total, value.toLowerCase() === `${r}${SUFFIX}`.toLowerCase(), tr('All districts'))}
                      {info.districts.map((d) => row(d.name, d.count, value.toLowerCase() === d.name.toLowerCase()))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
