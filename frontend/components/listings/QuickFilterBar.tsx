'use client';

import { SaveSearchButton } from './SaveSearchButton';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCountry } from '@/context/CountryContext';
import { useTr } from '@/lib/i18n/useTr';
import { LocationPicker } from './LocationPicker';

const PRICE_PRESETS = [
  { label: 'Under 65K', min: '', max: '65000' },
  { label: '65K – 270K', min: '65000', max: '270000' },
  { label: '270K – 1M', min: '270000', max: '1000000' },
  { label: 'Over 1M', min: '1000000', max: '' },
];

const SORTS: [string, string][] = [
  ['recommended', 'Recommended'],
  ['createdAt', 'Most Recent'],
  ['price_asc', 'Lowest Price'],
  ['price_desc', 'Highest Price'],
  ['views', 'Most Popular'],
];

type PanelId = 'price' | 'sort';

function Chip({
  active, onClick, children, caret = false, label, expanded,
}: {
  active: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode;
  caret?: boolean; label?: string; expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={caret ? undefined : active}
      aria-expanded={caret ? expanded : undefined}
      aria-haspopup={caret ? 'dialog' : undefined}
      aria-label={label}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors ${
        active ? 'border-red-500 bg-red-500 text-white shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-red-300 hover:text-red-600'
      }`}
    >
      {children}
      {caret && (
        <svg className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      )}
    </button>
  );
}

/**
 * Sticky chip bar for /listings: price, location, condition, verified sellers, with photos, sort,
 * plus a live result count. Mirrors the URL params the sidebar uses, so both stay in sync.
 */
export function QuickFilterBar({
  total, loading, activeCount, onMore,
}: { total: number; loading: boolean; activeCount: number; onMore: () => void }) {
  const tr = useTr();
  const router = useRouter();
  const params = useSearchParams();
  const { country } = useCountry();
  const [open, setOpen] = useState<PanelId | null>(null);
  const [locOpen, setLocOpen] = useState(false);
  const [locAnchor, setLocAnchor] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  const get = (k: string) => params?.get(k) || '';
  const priceMin = get('priceMin');
  const priceMax = get('priceMax');
  const location = get('location');
  const condition = get('condition');
  const verified = get('verifiedOnly') === 'true';
  const photos = get('withPhotos') === 'true';
  const sort = get('sort') || (get('q') ? 'relevance' : 'recommended');
  const hasPrice = !!(priceMin || priceMax);

  const push = (updates: Record<string, string>) => {
    const p = new URLSearchParams(params ? params.toString() : '');
    Object.entries(updates).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    p.set('page', '1');
    router.push(`/listings?${p.toString()}`);
  };

  const openPanel = (id: PanelId) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (open === id) { setOpen(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 296)), top: r.bottom + 6 });
    setMin(priceMin); setMax(priceMax);
    setOpen(id);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (panelRef.current?.contains(t) || t.closest('[aria-haspopup="dialog"]')) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    const onScroll = () => { if (window.innerWidth >= 640) setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll); };
  }, [open]);

  const priceLabel = hasPrice
    ? `${priceMin ? Number(priceMin).toLocaleString('en-US') : '0'} – ${priceMax ? Number(priceMax).toLocaleString('en-US') : '∞'}`
    : tr('Price');

  const panelCls = 'fixed inset-x-0 bottom-0 z-[91] max-h-[70vh] overflow-y-auto rounded-t-2xl border border-gray-100 bg-white p-4 shadow-2xl animate-fade-up sm:inset-x-auto sm:bottom-auto sm:left-[var(--qf-left)] sm:top-[var(--qf-top)] sm:w-72 sm:max-h-[60vh] sm:rounded-xl sm:animate-scale-in';

  return (
    <div
      className="sticky z-30 -mx-3 mb-3 border-y border-gray-100 bg-white/95 px-3 py-2 shadow-sm backdrop-blur sm:-mx-4 sm:px-4"
      style={{ top: 'var(--site-header-h, 0px)' }}
      role="region"
      aria-label={tr('Quick filters')}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip active={false} caret expanded={open === 'sort'} onClick={openPanel('sort')} label={tr('Sort')}>
            <span aria-hidden>↕</span> {tr(SORTS.find(([k]) => k === sort)?.[1] ?? 'Sort')}
          </Chip>
          <Chip active={hasPrice} caret expanded={open === 'price'} onClick={openPanel('price')} label={tr('Price')}>
            <span aria-hidden>💰</span> {priceLabel}
          </Chip>
          <Chip active={!!location} caret expanded={locOpen} onClick={(e) => { setOpen(null); setLocAnchor(e.currentTarget as HTMLElement); setLocOpen((o) => !o); }} label={tr('Location')}>
            <span aria-hidden>📍</span> {location || tr('Location')}
          </Chip>
          <Chip active={condition === 'NEW'} onClick={() => push({ condition: condition === 'NEW' ? '' : 'NEW' })}>✨ {tr('New')}</Chip>
          <Chip active={condition === 'USED'} onClick={() => push({ condition: condition === 'USED' ? '' : 'USED' })}>📦 {tr('Used')}</Chip>
          <Chip active={verified} onClick={() => push({ verifiedOnly: verified ? '' : 'true' })}>🛡️ {tr('Verified sellers')}</Chip>
          <Chip active={photos} onClick={() => push({ withPhotos: photos ? '' : 'true' })}>📷 {tr('With photos')}</Chip>
        </div>

        <div className="flex shrink-0 items-center gap-2 pl-1">
          <SaveSearchButton />
          <p className="text-xs text-gray-500 md:hidden" role="status" aria-live="polite">
            {loading ? tr('Loading…') : <><b className="tabular-nums text-gray-900">{total.toLocaleString('en-US')}</b> {total === 1 ? tr('result') : tr('results')}</>}
          </p>
          <button type="button" onClick={onMore} className="relative inline-flex h-8 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 hover:border-red-300 hover:text-red-600 md:hidden">
            ☰ {tr('Categories')}
            {activeCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] text-white">{activeCount}</span>}
          </button>
        </div>
      </div>

      {/* Rendered into <body>: this bar uses backdrop-blur, which turns it into the containing block for
          position:fixed children, so panels used to be sized/positioned against the 40px bar and
          trapped under the header. A portal puts them back in viewport space. */}
      {open && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[90] bg-black/40 sm:hidden" aria-hidden onClick={() => setOpen(null)} />
          <div
            ref={panelRef}
            role="dialog"
            aria-label={open === 'price' ? tr('Price') : tr('Sort')}
            className={panelCls}
            style={{ ['--qf-left' as string]: `${pos.left}px`, ['--qf-top' as string]: `${pos.top}px` }}
          >
            {open === 'price' && (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRICE_PRESETS.map((p) => {
                    const on = p.min === priceMin && p.max === priceMax;
                    return (
                      <button key={p.label} type="button" onClick={() => { push({ priceMin: p.min, priceMax: p.max }); setOpen(null); }}
                        className={`rounded-lg border py-2 text-xs font-semibold ${on ? 'border-red-500 bg-red-500 text-white' : 'border-gray-200 text-gray-700 hover:border-red-300'}`}>{p.label}</button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input type="number" inputMode="numeric" min={0} value={min} onChange={(e) => setMin(e.target.value)} placeholder={tr('Min')} className="h-9 w-full rounded-lg border border-gray-200 px-2 text-sm" />
                  <span className="text-gray-300">—</span>
                  <input type="number" inputMode="numeric" min={0} value={max} onChange={(e) => setMax(e.target.value)} placeholder={tr('Max')} className="h-9 w-full rounded-lg border border-gray-200 px-2 text-sm" />
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => { push({ priceMin: '', priceMax: '' }); setOpen(null); }} className="flex-1 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-gray-600">{tr('Clear')}</button>
                  <button type="button" onClick={() => { push({ priceMin: min, priceMax: max }); setOpen(null); }} className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-bold text-white hover:bg-red-700">{tr('Apply')}</button>
                </div>
              </>
            )}
            {open === 'sort' && (
              <ul className="space-y-0.5">
                {SORTS.filter(([k]) => k !== 'relevance').map(([k, label]) => (
                  <li key={k}><button type="button" onClick={() => { push({ sort: k }); setOpen(null); }} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${sort === k ? 'bg-red-50 font-semibold text-red-700' : 'hover:bg-gray-50'}`}>{tr(label)}</button></li>
                ))}
              </ul>
            )}
          </div>
        </>,
        document.body,
      )}
      <LocationPicker open={locOpen} onClose={() => setLocOpen(false)} value={location} onSelect={(v) => push({ location: v })} anchor={locAnchor} />
      <span className="sr-only">{country}</span>
    </div>
  );
}
