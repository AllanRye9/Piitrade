'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import LocationDropdown from './LocationDropdown';
import { createPortal } from 'react-dom';
import { useCountry } from '@/context/CountryContext';
import { useTr } from '@/lib/i18n/useTr';
import { REGION_ORDER, useLocationDirectory, type RegionCount, type UgandaRegion } from '@/lib/useLocationDirectory';

const fmt = (n: number) => n.toLocaleString('en-US');
const REGION_SUFFIX = ' Region';

/** Which region tab should be open for the current value ("Gulu" → Northern, "Northern Region" → Northern). */
function regionOf(value: string, regions: RegionCount[]): UgandaRegion | null {
  if (!value) return null;
  const v = value.toLowerCase();
  const byRegion = regions.find((r) => r.label.toLowerCase() === v);
  if (byRegion) return byRegion.region;
  return regions.find((r) => r.districts.some((d) => d.name.toLowerCase() === v))?.region ?? null;
}

interface PickerProps {
  /** The button that opened the picker. On phones the picker hangs from it (see LocationDropdown). */
  anchor?: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  /** Current filter value: '' (all), a district ("Gulu") or a region ("Northern Region"). */
  value: string;
  onSelect: (value: string) => void;
}

/**
 * Location picker: "All Locations" on top, then Uganda's four regions as tabs, then only the districts
 * in that region that have live listings (with counts). A bottom sheet on phones, a dialog on desktop.
 * Typing in the box searches every district at once. If the counts request fails it falls back to the
 * site's short town list so the filter never becomes unusable.
 */
function LocationSheet({ open, onClose, value, onSelect }: PickerProps) {
  const tr = useTr();
  const { locations } = useCountry();
  const { data, error, loading } = useLocationDirectory(open);
  const [tab, setTab] = useState<UgandaRegion>('Central');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const regions = useMemo(() => data?.regions ?? [], [data]);
  const byRegion = useMemo(() => new Map(regions.map((r) => [r.region, r])), [regions]);

  // Each time it opens: clear the search and land on the region of the current choice (or the busiest).
  useEffect(() => {
    if (!open) return;
    setQuery('');
  }, [open]);
  useEffect(() => {
    if (!open || regions.length === 0) return;
    const current = regionOf(value, regions);
    const busiest = [...regions].sort((a, b) => b.total - a.total)[0]?.region;
    setTab(current ?? busiest ?? 'Central');
  }, [open, regions, value]);

  // Escape closes, the page behind stops scrolling, and on desktop the search box takes focus
  // (not on phones: that would raise the keyboard over the list).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (window.innerWidth >= 640) searchRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const pick = (v: string) => { onSelect(v); onClose(); };
  const q = query.trim().toLowerCase();
  const active = byRegion.get(tab);

  const searchHits = q
    ? regions.flatMap((r) => r.districts.filter((d) => d.name.toLowerCase().includes(q)).map((d) => ({ ...d, region: r.region })))
    : [];

  const chip = (name: string, count: number | null, selected: boolean, sub?: string) => (
    <button
      key={name + (sub ?? '')}
      type="button"
      onClick={() => pick(name)}
      aria-pressed={selected}
      className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
        selected ? 'border-red-600 bg-red-600 font-bold text-white' : 'border-gray-200 bg-white text-gray-800 hover:border-red-300 hover:bg-red-50'
      }`}
    >
      <span className="min-w-0 truncate">
        {name}
        {sub && <span className={`ml-1 text-[11px] font-medium ${selected ? 'text-red-100' : 'text-gray-400'}`}>{sub}</span>}
      </span>
      {count !== null && (
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${selected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
          {fmt(count)}
        </span>
      )}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-black/45" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Choose location')}
        className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl animate-fade-up sm:max-h-[80vh] sm:w-[34rem] sm:rounded-2xl sm:animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-base font-extrabold text-gray-900"><span aria-hidden>📍</span> {tr('Choose location')}</h2>
          <button type="button" onClick={onClose} aria-label={tr('Close')} className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-gray-500 hover:bg-gray-100">×</button>
        </div>

        {/* Search + All Locations */}
        <div className="space-y-2 px-4 pb-3">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Search district or town')}
            aria-label={tr('Search district or town')}
            className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm focus:border-red-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-100"
          />
          {!q && (
            <button
              type="button"
              onClick={() => pick('')}
              aria-pressed={!value}
              className={`flex min-h-[48px] w-full items-center justify-between rounded-xl border px-3 text-left text-sm ${
                !value ? 'border-red-600 bg-red-600 font-bold text-white' : 'border-gray-200 bg-white font-semibold text-gray-800 hover:border-red-300 hover:bg-red-50'
              }`}
            >
              <span>{tr('All Locations')} <span className={`text-xs font-medium ${!value ? 'text-red-100' : 'text-gray-400'}`}>· {tr('Whole of Uganda')}</span></span>
              {data && data.total > 0 && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${!value ? 'bg-white/20' : 'bg-gray-100 text-gray-600'}`}>{fmt(data.total)}</span>
              )}
            </button>
          )}
        </div>

        {/* Body */}
        <div className="min-h-[14rem] flex-1 overflow-y-auto border-t border-gray-100 px-4 pb-4 pt-3">
          {loading && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-busy="true">
              {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          )}

          {/* Counts unavailable: still let people choose a town. */}
          {error && !data && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">{tr('Popular towns')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {locations.filter((l) => !q || l.toLowerCase().includes(q)).map((l) => chip(l, null, value === l))}
              </div>
            </div>
          )}

          {data && regions.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-500">{tr('No listings yet')}</p>
          )}

          {data && regions.length > 0 && q && (
            searchHits.length === 0
              ? <p className="py-10 text-center text-sm text-gray-500">{tr('No districts match')}</p>
              : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{searchHits.map((d) => chip(d.name, d.count, value === d.name, d.region))}</div>
          )}

          {data && regions.length > 0 && !q && (
            <>
              <div role="tablist" aria-label={tr('Regions of Uganda')} className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-gray-100 p-1">
                {REGION_ORDER.map((r) => {
                  const info = byRegion.get(r);
                  const on = tab === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      role="tab"
                      id={`loc-tab-${r}`}
                      aria-selected={on}
                      aria-controls="loc-panel"
                      disabled={!info}
                      onClick={() => setTab(r)}
                      className={`flex min-h-[48px] flex-col items-center justify-center rounded-lg px-1 text-xs transition-colors ${
                        on ? 'bg-white font-extrabold text-red-600 shadow-sm' : info ? 'font-semibold text-gray-600 hover:bg-white/60' : 'cursor-not-allowed font-medium text-gray-300'
                      }`}
                    >
                      <span>{tr(r)}</span>
                      <span className="text-[10px] font-bold tabular-nums">{info ? fmt(info.total) : '–'}</span>
                    </button>
                  );
                })}
              </div>

              <div id="loc-panel" role="tabpanel" aria-labelledby={`loc-tab-${tab}`}>
                {active ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="col-span-2 sm:col-span-3">
                      {chip(`${tab}${REGION_SUFFIX}`, active.total, value.toLowerCase() === `${tab}${REGION_SUFFIX}`.toLowerCase(), tr('All districts'))}
                    </div>
                    {active.districts.map((d) => chip(d.name, d.count, value.toLowerCase() === d.name.toLowerCase()))}
                  </div>
                ) : (
                  <p className="py-10 text-center text-sm text-gray-500">{tr('No listings yet')}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** True on phone-width screens (re-evaluated when the window is resized or rotated). */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return phone;
}

/**
 * Location picker. Phones get a small dropdown hanging from the button (regions as an accordion, no dimmed
 * overlay, no scroll-lock); tablets and desktops get the centred dialog with region tabs.
 */
export function LocationPicker(props: PickerProps) {
  const phone = useIsPhone();
  if (phone && props.anchor) return <LocationDropdown {...props} anchor={props.anchor} />;
  return <LocationSheet {...props} />;
}

/**
 * Trigger + picker in one: a full-width button that shows the current choice and opens the picker.
 * Drop-in replacement for the old `<select>` of locations.
 */
export function LocationField({
  value, onChange, className = '', compact = false,
}: { value: string; onChange: (v: string) => void; className?: string; compact?: boolean }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center justify-between gap-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-red-100 ${className}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden>📍</span>
          <span className={`truncate ${value ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{value || tr('All Locations')}</span>
        </span>
        {!compact && <span aria-hidden className="text-xs text-gray-400">▾</span>}
      </button>
      <LocationPicker open={open} onClose={() => setOpen(false)} value={value} onSelect={onChange} anchor={btnRef.current} />
    </>
  );
}
