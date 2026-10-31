'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTr } from '@/lib/i18n/useTr';

/** Searchable single-select for ad locations (every Uganda district). Type to filter, tap to choose. */
export default function DistrictSelect({
  value, onChange, options, className = '',
}: { value: string; onChange: (v: string) => void; options: string[]; className?: string }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const starts = options.filter((o) => o.toLowerCase().startsWith(q));
    const contains = options.filter((o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [options, query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open]);

  const pick = (v: string) => { onChange(v); setQuery(''); setOpen(false); };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? query : value}
        placeholder={tr('Search district or town…')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); if (filtered[active]) pick(filtered[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-400"
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">{tr('No matching district')}</li>}
          {filtered.map((o, i) => (
            <li key={o} role="option" aria-selected={o === value}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onTouchEnd={(e) => { e.preventDefault(); pick(o); }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === active ? 'bg-red-50 text-red-700' : 'text-gray-800 hover:bg-gray-50'}`}
              >
                <span>{o}</span>{o === value && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
