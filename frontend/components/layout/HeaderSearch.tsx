'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { topCategories } from '@/components/layout/CategoryBar';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';
import { resolveImageUrl, formatCurrency } from '@/lib/utils';
import { useTr } from '@/lib/i18n/useTr';
import { searchByImage, type ImageSearchResult } from '@/lib/imageSearch';
import CameraCaptureModal from '@/components/search/CameraCaptureModal';

const RECENT_SEARCHES_KEY = 'piitrade_recent_searches';
const MAX_RECENT = 6;

// Shown only until real data arrives (or if the popular-searches endpoint is
// unavailable). The live list comes from GET /listings/popular-searches.
const FALLBACK_POPULAR_SEARCHES = ['iPhone', 'Toyota', 'Laptop', 'Apartment for rent', 'Land for sale', 'Samsung', 'Sofa set', 'Generator'];

const PRICE_PRESETS: { label: string; min: string; max: string }[] = [
  { label: 'Under 100K', min: '', max: '100000' },
  { label: '100K – 500K', min: '100000', max: '500000' },
  { label: '500K – 2M', min: '500000', max: '2000000' },
  { label: 'Over 2M', min: '2000000', max: '' },
];

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
  | { kind: 'popular'; label: string }
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
  const tr = useTr();
  const { country } = useCountry();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(false);
  // Unique per instance: the desktop and mobile variants can both be mounted.
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [popular, setPopular] = useState<string[]>(FALLBACK_POPULAR_SEARCHES);
  const [remote, setRemote] = useState<RemoteSuggest | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [photo, setPhoto] = useState<{ status: 'analyzing' | 'done' | 'error'; preview: string; result?: ImageSearchResult; error?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Second input forces the native camera on phones/tablets (capture attr); fileRef stays the gallery/file picker.
  const captureRef = useRef<HTMLInputElement>(null);
  const photoBtnRef = useRef<HTMLButtonElement>(null);
  const photoMenuRef = useRef<HTMLDivElement>(null);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [condition, setCondition] = useState<'' | 'NEW' | 'USED'>('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRecent(readRecentSearches()), []);

  // Real "Popular searches": what people actually searched for lately.
  useEffect(() => {
    let cancelled = false;
    api.get('/listings/popular-searches', { params: { limit: 8 } })
      .then(({ data }) => {
        const terms = Array.isArray(data?.terms) ? (data.terms as { term: string }[]).map((t) => t.term).filter(Boolean) : [];
        if (!cancelled && terms.length >= 3) setPopular(terms);
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);

  // "/" or Ctrl/Cmd+K focuses the desktop search from anywhere (standard on large marketplaces).
  useEffect(() => {
    if (variant !== 'desktop') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!photoMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (photoMenuRef.current?.contains(t) || photoBtnRef.current?.contains(t)) return;
      setPhotoMenu(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPhotoMenu(false); photoBtnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [photoMenu]);

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
      const rec = recent.map((label): Suggestion => ({ kind: 'recent', label }));
      const lower = new Set(recent.map((r) => r.toLowerCase()));
      const pop = popular.filter((t) => !lower.has(t.toLowerCase())).map((label): Suggestion => ({ kind: 'popular', label }));
      return [...rec, ...pop];
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
  }, [q, recent, remote, popular]);

  const runSearch = (term: string, categorySlug: string, fromPhoto = false) => {
    const params = new URLSearchParams();
    if (term.trim()) params.set('q', term.trim());
    if (categorySlug) params.set('category', categorySlug);
    params.set('country', country);
    if (priceMin) params.set('priceMin', priceMin);
    if (priceMax) params.set('priceMax', priceMax);
    if (condition) params.set('condition', condition);
    if (fromPhoto) params.set('photo', '1');
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
    } else if (s.kind === 'recent' || s.kind === 'popular') {
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

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void processPhoto(file);
  };

  // Phones/tablets hand off to the native camera (best quality, OS permission
  // prompt, correct orientation). Desktops use the in-page camera dialog, and
  // browsers with no camera API fall back to the file picker.
  const startTakePhoto = () => {
    setPhotoMenu(false);
    const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse || !navigator.mediaDevices?.getUserMedia) { captureRef.current?.click(); return; }
    setCameraOpen(true);
  };
  const startUpload = () => { setPhotoMenu(false); fileRef.current?.click(); };

  // Shared by gallery upload, native camera capture and the in-page camera.
  const processPhoto = async (file: File) => {
    setPhotoMenu(false);
    if (!file.type.startsWith('image/')) { setPhoto({ status: 'error', preview: '', error: 'Please choose an image file.' }); setOpen(true); return; }
    if (file.size > 10 * 1024 * 1024) { setPhoto({ status: 'error', preview: '', error: 'That photo is over 10 MB. Please choose a smaller one.' }); setOpen(true); return; }
    const preview = URL.createObjectURL(file);
    setPhoto({ status: 'analyzing', preview });
    setOpen(true);
    try {
      const result = await searchByImage(file);
      setPhoto({ status: 'done', preview, result });
      if (result.query) setQ(result.query);
      try { window.sessionStorage.setItem('piitrade_image_alts', JSON.stringify({ q: result.query, alts: result.alternatives })); } catch {}
      // Go straight to results when the terms found listings and no look-alike photos
      // need showing. Otherwise keep the panel open so the visitor can pick.
      if (result.query && result.count > 0 && result.visualMatches.length === 0) {
        runSearch(result.query, '', true);
      } else if (result.query && result.count === 0 && result.visualMatches.length === 0 && result.categories.length === 0) {
        runSearch(result.query, '', true);
      }
    } catch (err) {
      setPhoto({ status: 'error', preview, error: (err as Error)?.message || 'Photo search failed. Please try again.' });
    }
  };

  const removeRecent = (e: React.MouseEvent, term: string) => {
    e.stopPropagation();
    try {
      const next = readRecentSearches().filter((r) => r !== term);
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      setRecent(next);
    } catch {}
  };

  const activeFilterCount = (priceMin || priceMax ? 1 : 0) + (condition ? 1 : 0);

  const highlight = (text: string) => {
    const t = q.trim();
    if (!t) return text;
    const i = text.toLowerCase().indexOf(t.toLowerCase());
    if (i < 0) return text;
    return (<>{text.slice(0, i)}<strong className="font-bold text-gray-900">{text.slice(i, i + t.length)}</strong>{text.slice(i + t.length)}</>);
  };

  const groupLabel = (kind: Suggestion['kind']): string =>
    ({ recent: 'Recent searches', popular: 'Popular searches', term: 'Suggestions', category: 'Categories', subcategory: 'Categories', listing: 'Listings' } as const)[kind];

  const suggestionIcon = (s: Suggestion) => {
    if (s.kind === 'recent') return '🕐';
    if (s.kind === 'popular') return '🔥';
    if (s.kind === 'term') return '🔍';
    if (s.kind === 'category') return '📁';
    return '🔎';
  };

  const isDesktop = variant === 'desktop';

  return (
    <form
      onSubmit={handleSubmit}
      className={isDesktop ? 'hidden sm:flex flex-none w-[36%] lg:w-[40%] max-w-[32rem] min-w-0 self-center' : 'flex w-full'}
    >
      <div ref={wrapRef} className="relative w-full">
        <div
          className={
            isDesktop
              // One solid white pill with a crisp lining, filling the space between the
              // logo and the right-hand icons:
              // [ category ▾ | search input ...... | 📷 Photo | 🔍 ] — vertically centred
              // in the header row at a fixed, compact height.
              ? `flex w-full h-11 items-center rounded-full overflow-hidden bg-white transition-all shadow-sm ${scrolled ? 'ring-1 ring-gray-300 focus-within:ring-2 focus-within:ring-[var(--theme-primary)]' : 'ring-1 ring-white/40 focus-within:ring-2 focus-within:ring-white'}`
              // Mobile pill is always a solid, opaque white search bar sitting
              // directly on the brand-colour header — matching the reference
              // mobile layout's "Search for Flowers" pill exactly: a leading
              // magnifying-glass icon, no visible text button, and no
              // category dropdown cluttering the bar (category filtering
              // lives on the /listings results page instead) — rather than
              // a translucent white-on-white bar that loses contrast when
              // the header hasn't scrolled yet.
              : 'flex w-full items-center rounded-full overflow-hidden ring-1 ring-black/5 shadow-search focus-within:ring-2 focus-within:ring-white/70 transition-all bg-white'
          }
        >
          {isDesktop && (
            <div className="relative hidden self-stretch shrink-0 border-r border-gray-200 bg-gray-50 transition-colors hover:bg-gray-100 lg:block">
              <label htmlFor="header-search-category" className="sr-only">Search in category</label>
              <select
                id="header-search-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-full max-w-[6.5rem] cursor-pointer appearance-none truncate bg-transparent pl-4 pr-7 text-xs font-medium text-gray-700 focus:outline-none md:text-sm"
              >
                {TOP_LEVEL_CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>{o.value ? tr(o.label) : tr('All')}</option>
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
              onChange={(e) => { setQ(e.target.value); setOpen(true); setActiveIndex(-1); setPhoto(null); }}
              onFocus={() => { setOpen(true); setPhotoMenu(false); }}
              onKeyDown={handleKeyDown}
              placeholder={isDesktop ? tr('Search Piitrade…') : tr('Search products, brands and categories')}
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              autoComplete="off"
              className={`w-full pl-4 pr-8 ${isDesktop ? 'h-full text-sm md:text-base' : 'py-2.5 text-sm'} bg-white text-gray-900 text-ellipsis placeholder:text-gray-400 focus:outline-none`}
            />
            {!q && isDesktop && (
              <kbd aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-gray-200 bg-gray-50 px-1.5 text-[10px] text-gray-400 min-[1600px]:block">/</kbd>
            )}
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
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} className="sr-only" tabIndex={-1} aria-hidden="true" />
          <input ref={captureRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="sr-only" tabIndex={-1} aria-hidden="true" />
          {/* Search by photo: a clearly visible, tinted button (labelled on wide screens)
              that opens a Take photo / Upload menu. */}
          <button
            ref={photoBtnRef}
            type="button"
            onClick={() => { setPhotoMenu((v) => !v); setOpen(false); }}
            aria-label={tr('Search by photo')}
            title={tr('Search by photo')}
            aria-haspopup="menu"
            aria-expanded={photoMenu}
            className={`mx-1 flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-orange-50 text-[var(--theme-primary-dark)] ring-1 ring-orange-300 transition-colors hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] ${isDesktop ? 'h-8 px-2.5' : 'h-9 w-9'}`}
          >
            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h1.5l1.2-1.8A2 2 0 019.4 4.3h5.2a2 2 0 011.7.9L17.5 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            {isDesktop && <span className="hidden text-xs font-semibold xl:inline">{tr('Photo')}</span>}
          </button>
          <button
            type="submit"
            aria-label="Search"
            className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary)] text-white shadow-sm transition-all hover:brightness-110 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] focus-visible:ring-offset-2"
          >
            <svg className={isDesktop ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <span className="sr-only">Search</span>
          </button>
        </div>

        {photoMenu && (
          <div
            ref={photoMenuRef}
            role="menu"
            aria-label={tr('Search by photo')}
            className="absolute right-0 top-full z-[75] mt-2 w-64 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-2xl animate-fade-down"
          >
            <button type="button" role="menuitem" onClick={startTakePhoto} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-orange-50 focus-visible:bg-orange-50 focus-visible:outline-none">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--theme-primary)] text-white">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h1.5l1.2-1.8A2 2 0 019.4 4.3h5.2a2 2 0 011.7.9L17.5 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3.5" /></svg>
              </span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-gray-900">{tr('Take a photo')}</span><span className="block text-xs text-gray-500">{tr('Use your camera')}</span></span>
            </button>
            <button type="button" role="menuitem" onClick={startUpload} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-orange-50 focus-visible:bg-orange-50 focus-visible:outline-none">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[var(--theme-primary-dark)] ring-1 ring-orange-200">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2l1.6-1.6a2 2 0 012.8 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-gray-900">{tr('Upload a photo')}</span><span className="block text-xs text-gray-500">{tr('Choose from gallery or files')}</span></span>
            </button>
          </div>
        )}

        {open && (
          <div
            className={`absolute top-full z-[70] mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl animate-fade-in ${
              isDesktop ? 'left-1/2 w-[min(720px,94vw)] -translate-x-1/2' : 'left-0 right-0'
            }`}
          >
            {photo && (
              <div className={`flex items-center gap-3 border-b px-3 py-2.5 ${photo.status === 'error' ? 'border-red-100 bg-red-50' : 'border-gray-100 bg-orange-50/60'}`} role="status" aria-live="polite">
                {photo.preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.preview} alt="Your photo" className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-black/10" />
                )}
                <div className="min-w-0 flex-1 text-sm">
                  {photo.status === 'analyzing' && (<><p className="font-semibold text-gray-800">{tr('Analysing your photo…')}</p><p className="text-xs text-gray-500">Identifying the item so we can find matches.</p></>)}
                  {photo.status === 'done' && (<>
                    <p className="truncate font-semibold text-gray-800">{photo.result?.query ? `Looks like: ${photo.result.query}` : 'Found similar photos'}</p>
                    <p className="text-xs text-gray-500">
                      {photo.result && photo.result.count > 0 ? `${photo.result.count} matching listing${photo.result.count === 1 ? '' : 's'}` : 'No exact text match — try the options below.'}
                    </p>
                  </>)}
                  {photo.status === 'error' && (<><p className="font-semibold text-red-700">Photo search didn’t work</p><p className="text-xs text-red-600">{photo.error}</p></>)}
                </div>
                {photo.status === 'error' && (
                  <button type="button" onClick={() => fileRef.current?.click()} className="shrink-0 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Try another</button>
                )}
                {photo.status !== 'analyzing' && (
                  <button type="button" aria-label="Dismiss" onClick={() => setPhoto(null)} className="shrink-0 text-gray-400 hover:text-gray-600">✕</button>
                )}
              </div>
            )}

            {photo?.status === 'done' && photo.result && (
              <div className="border-b border-gray-100 px-3 py-2.5 space-y-2.5">
                {photo.result.query && photo.result.count > 0 && (
                  <button type="button" onClick={() => runSearch(photo.result!.query, '', true)}
                    className="w-full rounded-lg bg-[var(--theme-primary)] px-3 py-2 text-sm font-semibold text-white hover:brightness-110">
                    See {photo.result.count} result{photo.result.count === 1 ? '' : 's'} for “{photo.result.query}”
                  </button>
                )}
                {photo.result.visualMatches.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-gray-600">Similar photos</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {photo.result.visualMatches.map((m) => (
                        <button key={m.id} type="button" onClick={() => { setOpen(false); router.push(`/listings/${m.id}`); }}
                          className="w-24 shrink-0 text-left" title={m.title}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={resolveImageUrl(m.image)} alt={m.title} className="h-20 w-24 rounded-lg object-cover ring-1 ring-black/10" />
                          <span className="mt-1 block truncate text-[11px] text-gray-700">{m.title}</span>
                          <span className="block text-[11px] font-semibold text-gray-900">{formatCurrency(m.price, m.currency as never)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(photo.result.categories.length > 0 || photo.result.alternatives.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {photo.result.categories.map((c) => (
                      <button key={`c-${c.slug}`} type="button" onClick={() => runSearch('', c.slug, true)}
                        className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-800 hover:bg-orange-100">
                        Browse {c.name}
                      </button>
                    ))}
                    {photo.result.alternatives.slice(0, 4).map((a) => (
                      <button key={`a-${a}`} type="button" onClick={() => runSearch(a, '', true)}
                        className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                        {a}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!q.trim() && !photo && (
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
                <span className="mr-auto text-xs font-semibold text-gray-600">{tr('Search by photo')}</span>
                <button type="button" onClick={startTakePhoto} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--theme-primary)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h1.5l1.2-1.8A2 2 0 019.4 4.3h5.2a2 2 0 011.7.9L17.5 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><circle cx="12" cy="13" r="3.5" /></svg>
                  {tr('Take photo')}
                </button>
                <button type="button" onClick={startUpload} className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2l1.6-1.6a2 2 0 012.8 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  {tr('Upload')}
                </button>
              </div>
            )}

            {/* Refine (advanced) toggle row */}
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {category ? `${TOP_LEVEL_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? ''}` : tr('Searching all categories')} · Uganda
              </span>
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${showFilters || activeFilterCount ? 'border-[var(--theme-primary)] bg-white text-[var(--theme-primary-dark)]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                aria-expanded={showFilters}
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" /></svg>
                {tr('Refine')}{activeFilterCount ? ` (${activeFilterCount})` : ''}
              </button>
            </div>

            {showFilters && (
              <div className="space-y-3 border-b border-gray-100 px-3 py-3">
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">{tr('Price (UGX)')}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {PRICE_PRESETS.map((p) => {
                      const on = priceMin === p.min && priceMax === p.max;
                      return (
                        <button key={p.label} type="button" onClick={() => { setPriceMin(on ? '' : p.min); setPriceMax(on ? '' : p.max); }}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                          {tr(p.label)}
                        </button>
                      );
                    })}
                    <input type="number" inputMode="numeric" min={0} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder={tr('Min')} aria-label="Minimum price"
                      className="h-8 w-24 rounded-lg border border-gray-200 px-2 text-xs focus:border-[var(--theme-primary)] focus:outline-none" />
                    <span className="text-gray-300">–</span>
                    <input type="number" inputMode="numeric" min={0} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder={tr('Max')} aria-label="Maximum price"
                      className="h-8 w-24 rounded-lg border border-gray-200 px-2 text-xs focus:border-[var(--theme-primary)] focus:outline-none" />
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="mr-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">{tr('Condition')}</p>
                  {([['', 'Any'], ['NEW', 'New'], ['USED', 'Used']] as const).map(([v, l]) => (
                    <button key={l} type="button" onClick={() => setCondition(v)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${condition === v ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      {tr(l)}
                    </button>
                  ))}
                  {activeFilterCount > 0 && (
                    <button type="button" onClick={() => { setPriceMin(''); setPriceMax(''); setCondition(''); }} className="ml-auto text-xs font-semibold text-gray-400 underline underline-offset-2 hover:text-red-500">{tr('Reset')}</button>
                  )}
                </div>
              </div>
            )}

            <ul id={listboxId} role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
              {suggestions.map((s, i) => {
                const showHeader = i === 0 || groupLabel(suggestions[i - 1].kind) !== groupLabel(s.kind);
                return (
                  <li key={`${s.kind}-${s.label}-${i}`} role="option" aria-selected={i === activeIndex}>
                    {showHeader && (
                      <div className="flex items-center justify-between px-3 pb-1 pt-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{tr(groupLabel(s.kind))}</span>
                        {s.kind === 'recent' && (
                          <button type="button" onClick={clearRecent} className="text-[10px] font-semibold text-gray-400 transition-colors hover:text-red-500">{tr('Clear all')}</button>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => applySuggestion(s)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${i === activeIndex ? 'bg-red-50 text-red-700' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      {s.kind === 'listing' ? (
                        <>
                          {s.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={resolveImageUrl(s.image)} alt="" className="h-10 w-10 shrink-0 rounded-md bg-gray-100 object-cover" />
                          ) : (
                            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-100 text-sm">🛍️</span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{highlight(s.label)}</span>
                            {s.location && <span className="block truncate text-[11px] text-gray-400">📍 {s.location}</span>}
                          </span>
                          <span className="ml-2 shrink-0 text-sm font-bold text-gray-900">{formatCurrency(s.price)}</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true" className="w-5 shrink-0 text-center text-xs">{suggestionIcon(s)}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {s.kind === 'term' && s.corrected ? <>Did you mean <strong>{s.label}</strong>?</> : highlight(s.label)}
                          </span>
                          {(s.kind === 'category' || s.kind === 'subcategory') && (
                            <span className="ml-auto shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] capitalize text-gray-500">in {s.categorySlug}</span>
                          )}
                          {s.kind === 'recent' && (
                            <span role="button" tabIndex={0} aria-label={`Remove ${s.label}`} onClick={(e) => removeRecent(e, s.label)}
                              onKeyDown={(e) => { if (e.key === 'Enter') removeRecent(e as unknown as React.MouseEvent, s.label); }}
                              className="ml-auto shrink-0 rounded-full px-1.5 text-xs text-gray-300 hover:bg-gray-100 hover:text-gray-600">✕</span>
                          )}
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {q.trim() && (
              <button
                type="button"
                onClick={() => runSearch(q, category)}
                className="flex w-full items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-[var(--theme-primary-dark)] transition-colors hover:bg-red-50"
              >
                <span className="truncate">See all results for “{q.trim()}”{activeFilterCount ? ' with filters' : ''}</span>
                <span aria-hidden="true">→</span>
              </button>
            )}
            <div className="hidden items-center justify-between border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-400 sm:flex">
              <span>↑↓ to navigate · Enter to search · Esc to close</span>
              <span>Press <kbd className="rounded border border-gray-200 bg-gray-50 px-1">/</kbd> to search from anywhere</span>
            </div>
          </div>
        )}
      </div>
      {cameraOpen && (
        <CameraCaptureModal
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => { setCameraOpen(false); void processPhoto(file); }}
          onUploadInstead={() => { setCameraOpen(false); fileRef.current?.click(); }}
        />
      )}
    </form>
  );
}
