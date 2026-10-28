'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Category } from '@/lib/types';
import {
  addRecent, readRecents, resolveRecents, searchOptions, writeRecents, type PickerOption,
} from '@/components/ui/categoryPickerModel';

interface CategoryPickerProps {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

function findSelected(categories: Category[], id: string): string {
  for (const cat of categories) {
    if (cat.id === id) return cat.name;
    if (cat.children) {
      for (const sub of cat.children) {
        if (sub.id === id) return `${cat.name} › ${sub.name}`;
      }
    }
  }
  return '';
}

const MOBILE_QUERY = '(max-width: 639px)';

/**
 * Category picker for the post forms (single post and bulk post).
 *
 * SELLER surface: always shows the full tree, never gated by listing counts, so a seller can post
 * into an empty category. With ~290 categories it adds:
 *  - a search box (names, "Parent › Child", and the shared synonym list: "boda", "mivumba", "fundi"),
 *  - the seller's recent picks,
 *  - on phones, a full-screen sheet with drill-down (parents → children) instead of hover columns.
 */
export default function CategoryPicker({ categories, value, onChange, className = '' }: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [drillParentId, setDrillParentId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Phones get the full-screen sheet (hover does not exist on touch screens).
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Close on outside click (desktop dropdown only; the mobile sheet covers the screen)
  useEffect(() => {
    if (isMobile) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isMobile]);

  // Escape closes; the mobile sheet also locks page scroll while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    if (isMobile) document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, isMobile]);

  const selectedLabel = value ? findSelected(categories, value) : '';
  const activeParent = categories.find((c) => c.id === activeParentId) ?? categories.find((c) => c.children?.some((sub) => sub.id === value)) ?? null;
  const drillParent = categories.find((c) => c.id === drillParentId) ?? null;

  const results = useMemo(() => searchOptions(categories, query), [categories, query]);
  const recents = useMemo(() => resolveRecents(categories, recentIds), [categories, recentIds]);
  const searching = query.trim().length > 0;

  const handleSelect = (id: string) => {
    onChange(id);
    const next = addRecent(recentIds, id);
    setRecentIds(next);
    writeRecents(next);
    setOpen(false);
    setActiveParentId(null);
    setDrillParentId(null);
    setQuery('');
  };

  const handleToggle = () => {
    if (open) { setOpen(false); setActiveParentId(null); setDrillParentId(null); setQuery(''); return; }
    setRecentIds(readRecents());
    setQuery('');
    setHighlight(0);
    setDrillParentId(null);
    const firstParentWithChildren = categories.find((cat) => cat.children?.length)?.id ?? null;
    setActiveParentId((current) => current ?? firstParentWithChildren);
    setOpen(true);
  };

  useEffect(() => { if (open) searchRef.current?.focus(); }, [open, isMobile]);
  useEffect(() => { setHighlight(0); }, [query]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searching || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); handleSelect(results[highlight]?.id ?? results[0].id); }
  };

  const searchBox = (
    <div className="border-b border-gray-100 p-2">
      <label htmlFor="category-picker-search" className="sr-only">Search categories</label>
      <input
        id="category-picker-search"
        ref={searchRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder="Search categories (e.g. boda boda, salon, cement)"
        autoComplete="off"
        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-red-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-200"
      />
    </div>
  );

  const resultList = (
    <ul role="listbox" aria-label="Matching categories" className="max-h-[18rem] overflow-y-auto py-1 max-sm:max-h-none max-sm:flex-1">
      {results.length === 0 && (
        <li className="px-3 py-3 text-sm text-gray-500">No categories match “{query.trim()}”. Try a simpler word.</li>
      )}
      {results.map((o, i) => (
        <li
          key={o.id}
          role="option"
          aria-selected={o.id === value}
          onMouseEnter={() => setHighlight(i)}
          onClick={() => handleSelect(o.id)}
          className={`flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
            o.id === value ? 'bg-red-100 font-semibold text-red-800' : i === highlight ? 'bg-red-50 text-red-700' : 'text-gray-800 hover:bg-gray-50'
          }`}
        >
          {o.icon && <span aria-hidden="true">{o.icon}</span>}
          <span className="min-w-0">
            <span className="block truncate">{o.isParent ? `All in ${o.name}` : o.name}</span>
            {!o.isParent && <span className="block truncate text-xs text-gray-500">{o.parentName}</span>}
          </span>
        </li>
      ))}
    </ul>
  );

  const recentChips = recents.length > 0 && (
    <div className="border-b border-gray-100 px-3 py-2">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Recent</p>
      <ul className="flex flex-wrap gap-1.5">
        {recents.map((o: PickerOption) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => handleSelect(o.id)}
              className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-red-300 hover:bg-white hover:text-red-700"
              title={o.label}
            >
              {o.icon && <span aria-hidden="true">{o.icon}</span>}
              <span className="truncate">{o.isParent ? o.name : o.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const trigger = (
    <button
      type="button"
      onClick={handleToggle}
      className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-4 py-2.5 bg-white text-left focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors hover:border-red-400"
      aria-expanded={open}
      aria-haspopup="dialog"
    >
      <span className={selectedLabel ? 'text-gray-900' : 'text-gray-400'}>
        {selectedLabel || 'Select a category'}
      </span>
      <svg
        className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );

  // ── Phone: full-screen drill-down sheet ─────────────────────────────────────────────────────
  if (open && isMobile) {
    return (
      <div ref={containerRef} className={`relative ${className}`}>
        {trigger}
        <div role="dialog" aria-modal="true" aria-label="Choose a category" className="fixed inset-0 z-[400] flex flex-col bg-white">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
            {drillParent && !searching ? (
              <button type="button" onClick={() => setDrillParentId(null)} className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-700 hover:bg-gray-100" aria-label="Back to all categories">‹ Back</button>
            ) : null}
            <h2 className="flex-1 truncate text-base font-bold text-gray-900">
              {drillParent && !searching ? drillParent.name : 'Choose a category'}
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close">✕</button>
          </div>
          {searchBox}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {searching ? resultList : drillParent ? (
              <ul>
                <li>
                  <button type="button" onClick={() => handleSelect(drillParent.id)} className={`w-full px-4 py-3.5 text-left text-sm font-semibold ${drillParent.id === value ? 'bg-red-100 text-red-800' : 'text-gray-800 hover:bg-gray-50'}`}>
                    All in {drillParent.name}
                  </button>
                </li>
                {(drillParent.children ?? []).map((sub) => (
                  <li key={sub.id} className="border-t border-gray-100">
                    <button type="button" onClick={() => handleSelect(sub.id)} className={`flex w-full items-center gap-2 px-4 py-3.5 text-left text-sm ${sub.id === value ? 'bg-red-100 font-semibold text-red-800' : 'text-gray-800 hover:bg-gray-50'}`}>
                      {sub.icon && <span aria-hidden="true">{sub.icon}</span>}
                      {sub.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                {recentChips}
                <ul>
                  {categories.map((cat) => {
                    const hasChildren = !!cat.children?.length;
                    return (
                      <li key={cat.id} className="border-t border-gray-100 first:border-t-0">
                        <button
                          type="button"
                          onClick={() => (hasChildren ? setDrillParentId(cat.id) : handleSelect(cat.id))}
                          className={`flex w-full items-center justify-between gap-2 px-4 py-3.5 text-left text-sm ${cat.id === value ? 'bg-red-100 font-semibold text-red-800' : 'text-gray-800 hover:bg-gray-50'}`}
                        >
                          <span className="flex items-center gap-2">{cat.icon && <span aria-hidden="true">{cat.icon}</span>}{cat.name}</span>
                          {hasChildren && <span aria-hidden="true" className="text-gray-400">›</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop / tablet dropdown ───────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {trigger}

      {open && (
        <div className="absolute left-0 top-full mt-2 z-[300] flex w-full min-w-[220px] max-w-[min(100vw-2rem,42rem)] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl animate-scale-in">
          {searchBox}
          {searching ? resultList : (
            <>
              {recentChips}
              <div className="flex flex-col md:flex-row">
                {/* Parent categories (left column) */}
                <ul className="py-1 md:min-w-[220px] max-h-[18rem] overflow-y-auto">
                  {categories.map((cat) => {
                    const hasChildren = cat.children && cat.children.length > 0;
                    const isParentSelected = cat.id === value;
                    const isChildSelected = cat.children?.some((c) => c.id === value);
                    return (
                      <li
                        key={cat.id}
                        className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                          activeParentId === cat.id || isChildSelected
                            ? 'bg-red-50 text-red-700'
                            : isParentSelected
                            ? 'bg-red-100 text-red-800 font-semibold'
                            : 'text-gray-800 hover:bg-gray-50'
                        }`}
                        onMouseEnter={() => { if (hasChildren) setActiveParentId(cat.id); }}
                        onClick={() => {
                          if (hasChildren) {
                            setActiveParentId(cat.id);
                            return;
                          }
                          handleSelect(cat.id);
                        }}
                      >
                        <span className="flex items-center gap-2">
                          {cat.icon && <span aria-hidden="true">{cat.icon}</span>}
                          {cat.name}
                        </span>
                        {hasChildren && (
                          <svg className="w-3.5 h-3.5 opacity-50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {/* Subcategories (right column) — shown when a parent with children is active */}
                {activeParent && activeParent.children && activeParent.children.length > 0 && (
                  <ul className="py-1 md:min-w-[220px] max-h-[18rem] overflow-y-auto border-t border-gray-100 bg-gray-50 md:border-l md:border-t-0">
                    {/* Option to select the parent category itself */}
                    <li
                      className={`px-3 py-2 cursor-pointer text-sm transition-colors font-medium ${
                        activeParent.id === value ? 'bg-red-100 text-red-800' : 'text-gray-600 hover:bg-white hover:text-gray-900'
                      }`}
                      onClick={() => handleSelect(activeParent.id)}
                    >
                      All in {activeParent.name}
                    </li>
                    <li className="border-t border-gray-200 my-0.5" />
                    {activeParent.children.map((sub) => (
                      <li
                        key={sub.id}
                        className={`px-3 py-2 cursor-pointer text-sm transition-colors ${
                          sub.id === value ? 'bg-red-100 text-red-800 font-semibold' : 'text-gray-700 hover:bg-white hover:text-red-700'
                        }`}
                        onClick={() => handleSelect(sub.id)}
                      >
                        {sub.icon && <span className="mr-1.5" aria-hidden="true">{sub.icon}</span>}
                        {sub.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
