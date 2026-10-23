'use client';

import { useTr } from '@/lib/i18n/useTr';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCountry } from '@/context/CountryContext';
import { Category } from '@/lib/types';
import { useCategoryCounts } from '@/hooks/useCategoryCounts';
import { isBuyerVisible } from '@/lib/categoryVisibility';
import { formatCount } from '@/lib/formatCount';

interface Props {
  categories: Category[];
  isOpen?: boolean;
  onClose?: () => void;
}

const pricePresets = [
  { label: 'Under 65K', min: '', max: '65000' },
  { label: '65K – 270K', min: '65000', max: '270000' },
  { label: '270K – 1M', min: '270000', max: '1000000' },
  { label: 'Over 1M', min: '1000000', max: '' },
];

const SECTION_KEYS = ['trust', 'category', 'location', 'condition', 'price', 'sort'] as const;
type SectionKey = typeof SECTION_KEYS[number];

const STORAGE_KEY = 'piitrade:filters:collapsed-sections';

/** Collapsible section wrapper — every filter group can be expanded/collapsed
 *  independently, and the open/closed state is remembered between visits. */
function FilterSection({
  id,
  icon,
  title,
  collapsed,
  onToggle,
  children,
}: {
  id: SectionKey;
  icon: string;
  title: string;
  collapsed: boolean;
  onToggle: (id: SectionKey) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-100 last:border-b-0 pb-3 last:pb-0">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between gap-2 py-1 group interactive"
      >
        <h3 className="font-bold text-gray-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-transform duration-200 shrink-0 ${collapsed ? '-rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

export function FilterSidebar({ categories, isOpen = false, onClose }: Props) {
  const tr = useTr();
  const router = useRouter();
  const params = useSearchParams();
  const { country, locations } = useCountry();
  // Buyer surface: only categories that currently hold listings are offered (see lib/categoryVisibility.ts).
  const { counts } = useCategoryCounts(country);

  // Which sections are collapsed — persisted so the layout survives navigation/reloads.
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    trust: false, category: false, location: false, condition: false, price: false, sort: false,
  });
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed((prev) => ({ ...prev, ...JSON.parse(raw) }));
      const panelRaw = window.localStorage.getItem('piitrade:filters:panel-collapsed');
      if (panelRaw) setPanelCollapsed(panelRaw === 'true');
    } catch { /* ignore */ }
  }, []);

  // Mobile drawer: lock page scroll and close on Escape while it is open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [isOpen, onClose]);

  const toggleSection = (id: SectionKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const togglePanel = () => {
    setPanelCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem('piitrade:filters:panel-collapsed', String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const update = (key: string, value: string) => {
    const newParams = new URLSearchParams(params ? params.toString() : '');
    if (value) newParams.set(key, value);
    else newParams.delete(key);
    newParams.set('page', '1');
    router.push(`/listings?${newParams.toString()}`);
  };

  const updateMultiple = (updates: Record<string, string>) => {
    const newParams = new URLSearchParams(params ? params.toString() : '');
    Object.entries(updates).forEach(([key, value]) => {
      if (value) newParams.set(key, value);
      else newParams.delete(key);
    });
    newParams.set('page', '1');
    router.push(`/listings?${newParams.toString()}`);
  };

  const currentMin = params?.get('priceMin') || '';
  const currentMax = params?.get('priceMax') || '';

  const activePricePreset = pricePresets.find(
    (p) => p.min === currentMin && p.max === currentMax
  );

  const activeFilterCount = [
    params?.get('category'), params?.get('location'), params?.get('condition'),
    currentMin || currentMax, params?.get('verifiedOnly') === 'true' ? 'true' : '',
  ].filter(Boolean).length;

  // ── Category / subcategory cascade ────────────────────────────────────────────────────────────
  // `category` in the URL is either a top-level slug (whole tree) or a subcategory slug.
  const selectedSlug = params?.get('category') || '';
  const selectedParent =
    categories.find((c) => c.slug === selectedSlug) ??
    categories.find((c) => c.children?.some((ch) => ch.slug === selectedSlug));
  const selectedChild = selectedParent?.children?.find((ch) => ch.slug === selectedSlug);
  const sortByCount = (a: Category, b: Category) =>
    (counts?.[b.slug] ?? 0) - (counts?.[a.slug] ?? 0) || a.name.localeCompare(b.name);
  const parentOptions = categories.filter((c) => c.slug === selectedParent?.slug || isBuyerVisible(c.slug, counts));
  const childOptions = (selectedParent?.children ?? [])
    .filter((ch) => ch.slug === selectedSlug || isBuyerVisible(ch.slug, counts, selectedParent?.slug))
    .sort(counts ? sortByCount : () => 0);
  const withCount = (cat: Category) => {
    const n = counts?.[cat.slug];
    return `${cat.icon ? cat.icon + ' ' : ''}${cat.name}${n ? ` (${formatCount(n)})` : ''}`;
  };

  const content = (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 space-y-3">
      {/* Close button – mobile only */}
      {onClose && (
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 md:hidden">
          <h2 className="font-extrabold text-gray-900 text-base">{tr('Categories')}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors interactive"
            aria-label="Close filters"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Header – desktop */}
      <div className="hidden md:flex items-center justify-between pb-3 border-b border-gray-100">
        <h2 className="font-extrabold text-gray-900 text-sm flex items-center gap-1.5">
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" /></svg>
          Categories
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { router.push(`/listings?country=${country}`); onClose?.(); }}
            className="text-xs text-red-600 hover:text-red-700 font-semibold transition-colors interactive"
          >
            {tr('Clear all')}
          </button>
          <button
            onClick={togglePanel}
            aria-label="Collapse filter panel"
            className="text-gray-400 hover:text-gray-600 transition-colors interactive"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
      </div>

      <FilterSection id="category" icon="📂" title={tr('Category')} collapsed={collapsed.category} onToggle={toggleSection}>
        <select
          aria-label={tr('Category')}
          value={selectedParent?.slug || ''}
          onChange={(e) => update('category', e.target.value)}
          className="input-premium text-sm"
        >
          <option value="">{tr('All Categories')}</option>
          {parentOptions.map((cat) => (
            <option key={cat.id} value={cat.slug}>{withCount(cat)}</option>
          ))}
        </select>

        {selectedParent && childOptions.length > 0 && (
          <select
            aria-label={tr('Subcategory')}
            value={selectedChild ? selectedChild.slug : ''}
            onChange={(e) => update('category', e.target.value || selectedParent.slug)}
            className="input-premium mt-2 text-sm"
          >
            <option value="">{tr('All in')} {selectedParent.name}</option>
            {childOptions.map((ch) => (
              <option key={ch.id} value={ch.slug}>{withCount(ch)}</option>
            ))}
          </select>
        )}

        {selectedParent && (
          <button
            type="button"
            onClick={() => update('category', '')}
            className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-100"
            aria-label={`${tr('Clear category filter')}: ${selectedParent.name}${selectedChild ? ' › ' + selectedChild.name : ''}`}
          >
            <span className="truncate">
              {selectedParent.icon ? `${selectedParent.icon} ` : ''}{selectedParent.name}{selectedChild ? ` › ${selectedChild.name}` : ''}
            </span>
            <span aria-hidden="true" className="text-gray-400">×</span>
          </button>
        )}
      </FilterSection>

    </div>
  );

  // Collapsed rail — desktop only, shown instead of the full panel to free up width
  const collapsedRail = (
    <button
      onClick={togglePanel}
      aria-label="Expand categories"
      className="hidden md:flex flex-col items-center gap-2 w-11 shrink-0 bg-white rounded-xl border border-gray-100 shadow-sm py-4 hover:border-red-200 hover:bg-red-50/40 transition-colors interactive sticky h-fit"
      style={{ top: 'calc(var(--site-header-h, 0px) + 3.75rem)' }}
    >
      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" /></svg>
      <span className="text-[10px] font-bold text-gray-500 [writing-mode:vertical-lr] tracking-wider">CATEGORIES</span>
      {activeFilterCount > 0 && (
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold">
          {activeFilterCount}
        </span>
      )}
      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
    </button>
  );

  return (
    <>
      {/* Desktop sidebar — collapses to a slim rail to give listings more width */}
      {panelCollapsed ? collapsedRail : (
        <aside className="hidden md:block w-60 shrink-0">
          <div className="sticky" style={{ top: 'calc(var(--site-header-h, 0px) + 3.75rem)' }}>
            {content}
          </div>
        </aside>
      )}

      {/* Mobile drawer */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[90] md:hidden animate-fade-in"
            onClick={onClose}
            aria-hidden="true"
          />
          <div role="dialog" aria-modal="true" aria-label="Categories" className="fixed inset-y-0 left-0 w-72 max-w-[85vw] z-[91] md:hidden overflow-y-auto animate-slide-down bg-gray-50">
            <div className="min-h-full p-3">
              {content}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
