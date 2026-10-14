'use client';

import { useTr } from '@/lib/i18n/useTr';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCountry } from '@/context/CountryContext';
import { Category } from '@/lib/types';

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

  const content = (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5 space-y-3">
      {/* Close button – mobile only */}
      {onClose && (
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 md:hidden">
          <h2 className="font-extrabold text-gray-900 text-base">{tr('Filters')}</h2>
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
          Filters
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

      {/* ── Verified Sellers filter ── */}
      <FilterSection id="trust" icon="🛡️" title={tr('Trust & Safety')} collapsed={collapsed.trust} onToggle={toggleSection}>
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <div className="relative">
            <input
              type="checkbox"
              checked={params?.get('verifiedOnly') === 'true'}
              onChange={(e) => update('verifiedOnly', e.target.checked ? 'true' : '')}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 peer-checked:bg-emerald-500 rounded-full transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
          </div>
          <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">
            {tr('KYC Verified Sellers Only')}
          </span>
        </label>
        <p className="text-[10px] text-gray-400 mt-1.5">
          See only listings from identity-verified sellers
        </p>
      </FilterSection>

      <FilterSection id="category" icon="📂" title={tr('Category')} collapsed={collapsed.category} onToggle={toggleSection}>
        <select
          value={params?.get('category') || ''}
          onChange={(e) => update('category', e.target.value)}
          className="input-premium text-sm"
        >
          <option value="">{tr('All Categories')}</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.slug}>{cat.icon} {cat.name}</option>
          ))}
        </select>
      </FilterSection>

      <FilterSection id="location" icon="📍" title={tr('Location')} collapsed={collapsed.location} onToggle={toggleSection}>
        <select
          value={params?.get('location') || ''}
          onChange={(e) => update('location', e.target.value)}
          className="input-premium text-sm"
        >
          <option value="">{tr('All Locations')}</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
      </FilterSection>

      <FilterSection id="condition" icon="🏷️" title={tr('Condition')} collapsed={collapsed.condition} onToggle={toggleSection}>
        <div className="flex gap-2">
          {[
            { value: '', label: 'Any' },
            { value: 'NEW', label: '✨ New' },
            { value: 'USED', label: '📦 Used' },
          ].map((c) => (
            <button
              key={c.value}
              onClick={() => update('condition', c.value)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all interactive border ${
                params?.get('condition') === c.value || (!params?.get('condition') && c.value === '')
                  ? 'bg-red-500 text-white border-red-500 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-red-200 hover:text-red-600'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection id="price" icon="💰" title={tr('Price Range')} collapsed={collapsed.price} onToggle={toggleSection}>
        {/* Preset ranges */}
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {pricePresets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => updateMultiple({ priceMin: preset.min, priceMax: preset.max })}
              className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all interactive border ${
                activePricePreset?.label === preset.label
                  ? 'bg-red-500 text-white border-red-500 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-red-200 hover:text-red-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Custom range */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              placeholder="Min"
              value={currentMin}
              onChange={(e) => update('priceMin', e.target.value)}
              className="input-premium text-sm pl-2 pr-2"
            />
          </div>
          <span className="flex items-center text-gray-300 font-medium">—</span>
          <div className="relative flex-1">
            <input
              type="number"
              placeholder="Max"
              value={currentMax}
              onChange={(e) => update('priceMax', e.target.value)}
              className="input-premium text-sm pl-2 pr-2"
            />
          </div>
        </div>
      </FilterSection>

      <FilterSection id="sort" icon="↕️" title={tr('Sort By')} collapsed={collapsed.sort} onToggle={toggleSection}>
        <select
          value={params?.get('sort') || 'createdAt'}
          onChange={(e) => update('sort', e.target.value)}
          className="input-premium text-sm"
        >
          <option value="createdAt">{tr('Most Recent')}</option>
          <option value="price_asc">{tr('Lowest Price')}</option>
          <option value="price_desc">{tr('Highest Price')}</option>
          <option value="views">{tr('Most Popular')}</option>
        </select>
      </FilterSection>

      <button
        onClick={() => { router.push(`/listings?country=${country}`); onClose?.(); }}
        className="w-full text-sm text-gray-500 hover:text-red-500 transition-colors text-center py-2 border border-dashed border-gray-200 rounded-xl hover:border-red-200 interactive"
      >
        🗑️ Clear All Filters
      </button>
    </div>
  );

  // Collapsed rail — desktop only, shown instead of the full panel to free up width
  const collapsedRail = (
    <button
      onClick={togglePanel}
      aria-label="Expand filters"
      className="hidden md:flex flex-col items-center gap-2 w-11 shrink-0 bg-white rounded-xl border border-gray-100 shadow-sm py-4 hover:border-red-200 hover:bg-red-50/40 transition-colors interactive sticky top-20 h-fit"
    >
      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" /></svg>
      <span className="text-[10px] font-bold text-gray-500 [writing-mode:vertical-lr] tracking-wider">FILTERS</span>
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
          <div className="sticky top-20">
            {content}
          </div>
        </aside>
      )}

      {/* Mobile drawer */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden animate-fade-in"
            onClick={onClose}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] z-50 md:hidden overflow-y-auto animate-slide-down bg-gray-50">
            <div className="min-h-full p-3">
              {content}
            </div>
          </div>
        </>
      )}
    </>
  );
}
