'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { topCategories } from '@/components/layout/CategoryBar';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';
import { resolveImageUrl, formatCurrency } from '@/lib/utils';

const RECENT_SEARCHES_KEY = 'piitrade_recent_searches';
const MAX_RECENT = 6;

const TOP_LEVEL_CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'motors', label: 'Motors' },
  { value: 'property', label: 'Property' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'fashion', label: 'Fashion' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'jobs', label: 'Jobs' },
  { value: 'services', label: 'Services' },
  { value: 'classifieds', label: 'Classifieds' },
];

type Suggestion =
  | { kind: 'recent'; label: string }
  | { kind: 'category'; label: string; categorySlug: string }
  | { kind: 'subcategory'; label: string; categorySlug: string; q: string }
  | { kind: 'term'; label: string; corrected?: boolean }
  | { kind: 'listing'; label: string; id: string; price: number; image: string | null; location: string | null };

interface RemoteSuggest {
  listings: { id: string; title: string; price: number; location: string | null; image: string | null }[];
  categories: { name: string; slug: string; parent?: { name: string; slug: string } | null }[];
  terms: string[];
  correctedQuery: string | null;
}

function readRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(term: string) {
  if (typeof window === 'undefined') return;
  const trimmed = term.trim();
  if (!trimmed) return;
  try {
    const existing = readRecentSearches().filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
    const next = [trimmed, ...existing].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode, etc.) — fail silently
  }
}

// Flat, searchable index of every subcategory across the mega menus, built
// once — this is what powers "type 'lap' and see Laptops under Electronics".
const SUBCATEGORY_INDEX: { label: string; categorySlug: string; q: string }[] = topCategories.flatMap((cat) => {
  const categorySlug = cat.href.replace(/^\//, '');
  return (cat.megaMenu ?? []).flatMap((col) =>
    col.links.map((link) => ({ label: link.label, categorySlug, q: link.label }))
  );
});

interface HeaderSearchProps {
  variant: 'desktop' | 'mobile';
  scrolled: boolean;
}

export default function HeaderSearch({ variant, scrolled }: HeaderSearchProps) {
  const router = useRouter();
  const { country } = useCountry();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [remote, setRemote] = useState<RemoteSuggest | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRecent(readRecentSearches()), []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Live suggestions from the search engine (typo-corrected, synonym-aware,
  // price-aware). Debounced + cancellable so fast typing never races.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRemote(null); return; }
    const controller = new AbortController();
    const id = setTimeout(() => {
      api.get('/listings/suggest', { params: { q: term, ...(category ? { category } : {}) }, signal: controller.signal })
        .then(({ data }) => { if (!controller.signal.aborted) setRemote(data as RemoteSuggest); })
        .catch(() => { /* keep whatever we had; local suggestions still work */ });
    }, 180);
    return () => { clearTimeout(id); controller.abort(); };
  }, [q, category]);

  const suggestions: Suggestion[] = useMemo(() => {
    const term = q.trim().toLowerCase();

    if (!term) {
      return recent.map((label): Suggestion => ({ kind: 'recent', label }));
    }

    const matchedCategories: Suggestion[] = TOP_LEVEL_CATEGORY_OPTIONS
      .filter((c) => c.value && c.label.toLowerCase().includes(term))
      .map((c) => ({ kind: 'category', label: c.label, categorySlug: c.value }));

    const matchedSubcategories: Suggestion[] = SUBCATEGORY_INDEX
      .filter((s) => s.label.toLowerCase().includes(term))
      .slice(0, 6)
      .map((s) => ({ kind: 'subcategory', label: s.label, categorySlug: s.categorySlug, q: s.q }));

    const out: Suggestion[] = [];
    if (remote?.correctedQuery) out.push({ kind: 'term', label: remote.correctedQuery, corrected: true });
    (remote?.terms ?? []).forEach((t) => out.push({ kind: 'term', label: t }));

    const seen = new Set<string>();
    const cats: Suggestion[] = [];
    for (const c of [...matchedCategories, ...matchedSubcategories]) {
      const key = c.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cats.push(c);
    }
    for (const c of remote?.categories ?? []) {
      const key = c.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cats.push({ kind: 'subcategory', label: c.name, categorySlug: c.parent?.slug || c.slug, q: c.name });
    }
    out.push(...cats.slice(0, 5));
    (remote?.listings ?? []).forEach((l) => out.push({ kind: 'listing', label: l.title, id: l.id, price: l.price, image: l.image, location: l.location }));
    return out.slice(0, 12);
  }, [q, recent, remote]);

  const runSearch = (term: string, categorySlug: string) => {
    const params = new URLSearchParams();
    if (term.trim()) params.set('q', term.trim());
    if (categorySlug) params.set('category', categorySlug);
    params.set('country', country);
    saveRecentSearch(term);
    setRecent(readRecentSearches());
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
    router.push(`/listings?${params.toString()}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(q, category);
  };

  const applySuggestion = (s: Suggestion) => {
    if (s.kind === 'listing') {
      saveRecentSearch(q);
      setOpen(false);
      inputRef.current?.blur();
      router.push(`/listings/${s.id}`);
    } else if (s.kind === 'term') {
      setQ(s.label);
      runSearch(s.label, category);
    } else if (s.kind === 'recent') {
      setQ(s.label);
      runSearch(s.label, category);
    } else if (s.kind === 'category') {
      setCategory(s.categorySlug);
      setOpen(false);
      runSearch(q, s.categorySlug);
    } else {
      setQ(s.q);
      setCategory(s.categorySlug);
      runSearch(s.q, s.categorySlug);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        applySuggestion(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const clearRecent = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { window.localStorage.removeItem(RECENT_SEARCHES_KEY); } catch {}
    setRecent([]);
  };

  const suggestionIcon = (s: Suggestion) => {
    if (s.kind === 'recent') return '🕐';
    if (s.kind === 'term') return '🔍';
    if (s.kind === 'category') return '📁';
    return '🔎';
  };

  const isDesktop = variant === 'desktop';

  return (
    <form
      onSubmit={handleSubmit}
      className={isDesktop ? 'hidden sm:flex flex-none w-[38%] lg:w-[44%] max-w-2xl min-w-0 self-center' : 'flex w-full'}
    >
      <div ref={wrapRef} className="relative w-full">
        <div
          className={
            isDesktop
              // Amazon-style bar: one solid white, squared-off (not pill) control that
              // fills ALL the space between the logo and the right-hand icons —
              // [ category ▾ | search input ............ | 🔍 ] — vertically centred
              // in the header row at a fixed, compact height.
              ? `flex w-full h-11 rounded-lg overflow-hidden bg-white transition-all shadow-sm ${scrolled ? 'ring-1 ring-gray-300 focus-within:ring-2 focus-within:ring-[var(--theme-primary)]' : 'ring-1 ring-white/40 focus-within:ring-2 focus-within:ring-white'}`
              // Mobile pill is always a solid, opaque white search bar sitting
              // directly on the brand-colour header — matching the reference
              // mobile layout's "Search for Flowers" pill exactly: a leading
              // magnifying-glass icon, no visible text button, and no
              // category dropdown cluttering the bar (category filtering
              // lives on the /listings results page instead) — rather than
              // a translucent white-on-white bar that loses contrast when
              // the header hasn't scrolled yet.
              : 'flex w-full rounded-full overflow-hidden ring-1 ring-black/5 shadow-search focus-within:ring-2 focus-within:ring-[var(--theme-primary)]/50 transition-all bg-white'
          }
        >
          {isDesktop && (
            <div className="relative shrink-0 border-r border-gray-300 bg-gray-100 transition-colors hover:bg-gray-200">
              <label htmlFor="header-search-category" className="sr-only">Search in category</label>
              <select
                id="header-search-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-full max-w-[9.5rem] cursor-pointer appearance-none truncate bg-transparent pl-3 pr-7 text-xs font-medium text-gray-700 focus:outline-none md:text-sm"
              >
                {TOP_LEVEL_CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>{o.value ? o.label : 'All'}</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          )}
          <div className="relative flex-1 min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); setActiveIndex(-1); }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={isDesktop ? 'Search products, brands…' : 'Search products, brands and categories'}
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
              autoComplete="off"
              className={`w-full pl-4 pr-8 ${isDesktop ? 'h-full text-sm md:text-base' : 'py-2.5 text-sm'} bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none`}
            />
            {q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => { setQ(''); setOpen(false); inputRef.current?.focus(); }}
                className={`absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-xs transition-colors ${
                  'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                }`}
              >
                ✕
              </button>
            )}
          </div>
          {/* Submit — moved from the left to the right end and given a solid
              brand fill. As a flat grey glyph on the left it read as
              decoration and users didn't realise it was the clickable
              search action. Same submit behaviour as before; only the
              position and styling changed. */}
          <button
            type="submit"
            aria-label="Search"
            className={`shrink-0 flex items-center justify-center gap-1.5 self-stretch ${isDesktop ? 'w-14' : 'px-4 sm:px-5'} font-semibold text-white bg-[var(--theme-primary)] hover:brightness-110 active:brightness-95 transition-all ${
              isDesktop ? 'text-sm' : 'text-xs'
            }`}
          >
            <svg className={isDesktop ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <span className="sr-only">Search</span>
          </button>
        </div>

        {open && suggestions.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-100 rounded-xl shadow-2xl z-[70] py-1.5 overflow-hidden animate-fade-in"
          >
            {!q.trim() && recent.length > 0 && (
              <div className="flex items-center justify-between px-3 pt-0.5 pb-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Recent Searches</span>
                <button type="button" onClick={clearRecent} className="text-[10px] text-gray-400 hover:text-red-500 transition-colors">Clear</button>
              </div>
            )}
            <ul role="listbox">
              {suggestions.map((s, i) => (
                <li key={`${s.kind}-${s.label}-${i}`} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => applySuggestion(s)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${i === activeIndex ? 'bg-red-50 text-red-700' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    {s.kind === 'listing' ? (
                      <>
                        {s.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={resolveImageUrl(s.image)} alt="" className="h-9 w-9 shrink-0 rounded-md bg-gray-100 object-cover" />
                        ) : (
                          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-sm">🛍️</span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{s.label}</span>
                          {s.location && <span className="block truncate text-[11px] text-gray-400">{s.location}</span>}
                        </span>
                        <span className="ml-2 shrink-0 text-xs font-bold text-gray-900">{formatCurrency(s.price)}</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true" className="text-xs shrink-0">{suggestionIcon(s)}</span>
                        <span className="truncate">
                          {s.kind === 'term' && s.corrected ? <>Did you mean <strong>{s.label}</strong>?</> : s.label}
                        </span>
                        {(s.kind === 'category' || s.kind === 'subcategory') && (
                          <span className="ml-auto text-[10px] text-gray-400 shrink-0 capitalize">{s.categorySlug}</span>
                        )}
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </form>
  );
}
