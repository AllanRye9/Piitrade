'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTr } from '@/lib/i18n/useTr';

export interface SearchCategoryOption { value: string; label: string; icon?: string; count?: number }

/** Categories shown before "Show all" — keeps the dropdown short on a busy marketplace. */
const INITIAL_VISIBLE = 8;

/**
 * Category picker for the header search bar (the "All ▾" control).
 * Shows "All" plus the top categories with icons; "Show all N categories" reveals the rest inside a
 * scrolling list with a filter box, so the dropdown never grows taller than the screen.
 */
export default function SearchCategorySelect({
  value, options, onChange,
}: { value: string; options: SearchCategoryOption[]; onChange: (v: string) => void }) {
  const tr = useTr();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const head = options.find((o) => o.value === '');
  const rest = useMemo(() => options.filter((o) => o.value !== ''), [options]);
  const current = options.find((o) => o.value === value);
  const q = filter.trim().toLowerCase();
  const shown = q ? rest.filter((o) => o.label.toLowerCase().includes(q)) : showAll ? rest : rest.slice(0, INITIAL_VISIBLE);
  // A selected category that is not in the short list stays visible.
  const withSelected = !showAll && !q && value && !shown.some((o) => o.value === value)
    ? [...shown, ...rest.filter((o) => o.value === value)] : shown;
  const hiddenCount = rest.length - INITIAL_VISIBLE;

  const pick = (v: string) => { onChange(v); setOpen(false); setFilter(''); };

  return (
    <div ref={wrapRef} className="relative hidden self-stretch shrink-0 border-r border-gray-200 bg-gray-50 transition-colors hover:bg-gray-100 lg:block">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={tr('Search in category')}
        onClick={() => setOpen((v) => !v)}
        className="flex h-full max-w-[7.5rem] items-center gap-1 truncate pl-4 pr-2 text-xs font-medium text-gray-700 focus:outline-none md:text-sm"
      >
        <span className="truncate">{value && current ? tr(current.label) : tr('All')}</span>
        <svg className={`h-3 w-3 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[70] mt-1 w-64 overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-2xl animate-scale-in">
          {(showAll || rest.length > INITIAL_VISIBLE) && (
            <div className="border-b border-gray-100 p-2">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={tr('Find a category')}
                aria-label={tr('Find a category')}
                className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs text-gray-800 focus:border-red-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-100"
              />
            </div>
          )}
          <ul id={id} role="listbox" className="max-h-[min(60vh,22rem)] overflow-y-auto py-1">
            {!q && head && (
              <li role="option" aria-selected={value === ''}>
                <button type="button" onClick={() => pick('')} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-red-50 ${value === '' ? 'bg-red-50 font-bold text-red-700' : 'font-semibold text-gray-800'}`}>
                  <span aria-hidden="true">🛍️</span>{tr('All categories')}
                </button>
              </li>
            )}
            {withSelected.map((o) => (
              <li key={o.value} role="option" aria-selected={value === o.value}>
                <button type="button" onClick={() => pick(o.value)} className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-red-50 ${value === o.value ? 'bg-red-50 font-bold text-red-700' : 'text-gray-700'}`}>
                  <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="w-5 text-center">{o.icon ?? '📦'}</span><span className="truncate">{tr(o.label)}</span></span>
                  {typeof o.count === 'number' && o.count > 0 && <span className="shrink-0 text-[11px] text-gray-400">{o.count}</span>}
                </button>
              </li>
            ))}
            {q && shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-gray-400">{tr('No category matches')}</li>}
          </ul>
          {!q && hiddenCount > 0 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full border-t border-gray-100 px-3 py-2 text-left text-[12.5px] font-semibold text-red-600 hover:bg-gray-50">
              {showAll ? tr('Show fewer') : `${tr('Show all')} ${rest.length} ${tr('categories')}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
