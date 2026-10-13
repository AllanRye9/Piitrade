'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import FarmerMarketplaceSection from '@/components/ui/FarmerMarketplaceSection';

/* ─── Types ────────────────────────────────────────────────────────────────── */

interface CommodityItem {
  id: string;
  name: string;
  unit: string;
  price: number;
  previousPrice: number | null;
  marketType: 'RETAIL' | 'WHOLESALE';
  location: string | null;
}

type SortKey = 'name' | 'price_asc' | 'price_desc' | 'change_desc' | 'change_asc';
type ViewMode = 'grid' | 'table';

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function formatUGX(value: number): string {
  return `UGX ${value.toLocaleString('en-UG', { maximumFractionDigits: value % 1 === 0 ? 0 : 2 })}`;
}

function trend(item: CommodityItem): 'up' | 'down' | 'flat' {
  if (item.previousPrice == null || item.previousPrice === item.price) return 'flat';
  return item.price > item.previousPrice ? 'up' : 'down';
}

function changePct(item: CommodityItem): number | null {
  if (item.previousPrice == null || item.previousPrice <= 0) return null;
  return ((item.price - item.previousPrice) / item.previousPrice) * 100;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toCSV(items: CommodityItem[]): string {
  const header = ['Commodity', 'Unit', 'Price (UGX)', 'Previous Price (UGX)', 'Change (%)', 'Market Type', 'Location'];
  const rows = items.map((it) => {
    const pct = changePct(it);
    return [
      it.name,
      it.unit,
      it.price,
      it.previousPrice ?? '',
      pct != null ? pct.toFixed(1) : '',
      it.marketType,
      it.location || '',
    ].join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

const COMMODITY_ICONS: Record<string, string> = {
  sugar: '🍬', coffee: '☕', cement: '🧱', beans: '🫘', 'maize flour': '🌽',
  rice: '🍚', 'cooking oil': '🛢️', salt: '🧂', milk: '🥛', charcoal: '🪵',
  electricity: '⚡', petrol: '⛽', diesel: '⛽',
};

function iconFor(name: string): string {
  return COMMODITY_ICONS[name.trim().toLowerCase()] ?? '🛒';
}

/* ─── Small UI atoms ───────────────────────────────────────────────────────── */

function TrendBadge({ item, size = 'sm' }: { item: CommodityItem; size?: 'sm' | 'xs' }) {
  const dir = trend(item);
  const pct = changePct(item);
  const textSize = size === 'xs' ? 'text-[11px]' : 'text-xs';

  if (dir === 'flat') {
    return <span className={`inline-flex items-center gap-1 ${textSize} font-semibold text-gray-400`}>— no change</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 ${textSize} font-bold ${dir === 'up' ? 'text-emerald-600' : 'text-error'}`}>
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        {dir === 'up' ? <path d="M10 3l6 8h-4v6H8v-6H4l6-8z" /> : <path d="M10 17l-6-8h4V3h4v6h4l-6 8z" />}
      </svg>
      {pct != null ? `${dir === 'up' ? '+' : ''}${pct.toFixed(1)}%` : dir === 'up' ? 'Up' : 'Down'}
    </span>
  );
}

function StatPill({ icon, label, value, color }: { icon: string; label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-white rounded-xl border border-gray-100 shadow-sm px-3.5 py-2.5 min-w-0 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${color}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-base font-black text-gray-900 leading-tight tabular-nums">{value}</p>
        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide truncate">{label}</p>
      </div>
    </div>
  );
}

/* ─── Main page ────────────────────────────────────────────────────────────── */

type Tab = 'prices' | 'farmer-marketplace';

function MarketPricesContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'farmer-marketplace' ? 'farmer-marketplace' : 'prices');
  const [items, setItems] = useState<CommodityItem[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [marketTypeFilter, setMarketTypeFilter] = useState<'' | 'RETAIL' | 'WHOLESALE'>('');
  const [sort, setSort] = useState<SortKey>('name');
  const [view, setView] = useState<ViewMode>('grid');

  const load = () => {
    return Promise.allSettled([
      api.get('/commodity-prices'),
      api.get('/commodity-prices/locations'),
    ]).then(([pricesResult, locationsResult]) => {
      if (pricesResult.status === 'fulfilled') {
        setItems(pricesResult.value.data?.items || []);
        setUpdatedAt(pricesResult.value.data?.updatedAt || null);
      }
      if (locationsResult.status === 'fulfilled') {
        setLocations(locationsResult.value.data?.locations || []);
      }
    });
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (locationFilter && (item.location || '') !== locationFilter) return false;
      if (marketTypeFilter && item.marketType !== marketTypeFilter) return false;
      return true;
    });

    const sorted = [...result];
    switch (sort) {
      case 'price_asc':
        sorted.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        sorted.sort((a, b) => b.price - a.price);
        break;
      case 'change_desc':
        sorted.sort((a, b) => (changePct(b) ?? -Infinity) - (changePct(a) ?? -Infinity));
        break;
      case 'change_asc':
        sorted.sort((a, b) => (changePct(a) ?? Infinity) - (changePct(b) ?? Infinity));
        break;
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [items, search, locationFilter, marketTypeFilter, sort]);

  // Market-wide summary stats (computed from the full dataset, not the filtered view)
  const summary = useMemo(() => {
    let gainers = 0, decliners = 0, unchanged = 0;
    for (const it of items) {
      const d = trend(it);
      if (d === 'up') gainers++;
      else if (d === 'down') decliners++;
      else unchanged++;
    }
    return { total: items.length, gainers, decliners, unchanged };
  }, [items]);

  // Top movers — biggest gainer & biggest decliner, for the highlight strip
  const topMovers = useMemo(() => {
    const withChange = items
      .map((it) => ({ item: it, pct: changePct(it) }))
      .filter((x): x is { item: CommodityItem; pct: number } => x.pct != null && x.pct !== 0);
    const gainers = [...withChange].sort((a, b) => b.pct - a.pct).slice(0, 3);
    const losers = [...withChange].sort((a, b) => a.pct - b.pct).slice(0, 3);
    return { gainers, losers };
  }, [items]);

  const hasActiveFilters = Boolean(search || locationFilter || marketTypeFilter);

  const handleExport = () => {
    const csv = toCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `piitrade-market-prices-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-3 sm:py-8">
      <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Market Prices' }]} className="mb-4" />

      {/* Hero banner — same gradient-header language as the homepage's
          <HomeMarketPrices /> / <FlashDeals /> sections, so this page feels
          like a continuation of that section rather than a plain utility
          page. */}
      <div
        className="relative overflow-hidden rounded-2xl shadow-lg mb-5 px-5 py-5 sm:px-7 sm:py-6 text-white animate-fade-up"
        style={{ background: 'linear-gradient(135deg,#E94B00 0%,#FF6500 50%,#FF8433 100%)' }}
      >
        <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-8 left-16 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-white/15 border border-white/25 backdrop-blur-sm flex items-center justify-center text-2xl shadow-md shrink-0">
              🇺🇬
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-wide uppercase">Uganda Market Prices</h1>
              <p className="text-xs sm:text-sm text-white/85 mt-0.5 max-w-2xl">
                Everyday commodity prices from Uganda&apos;s local markets, kept up to date by our team so buyers, traders, and businesses can check fair market value before they buy or sell.
              </p>
              {updatedAt && (
                <p className="text-[11px] text-white/75 mt-1.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white inline-block animate-pulse" />
                  Last updated {relativeTime(updatedAt)}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/30 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors shadow-sm disabled:opacity-50 backdrop-blur-sm"
          >
            <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs — "Uganda Market Prices" (admin-curated reference prices) vs
          "Farmer Marketplace" (farmer posts + buyer offers + delivered
          price calculator). Two different data sources, same page. */}
      <div className="flex flex-wrap gap-2 mb-5 border-b border-gray-200">
        <button
          onClick={() => setTab('prices')}
          className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${tab === 'prices' ? 'border-red-500 text-red-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          Uganda Market Prices
        </button>
        <button
          onClick={() => setTab('farmer-marketplace')}
          className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition-colors ${tab === 'farmer-marketplace' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          🚜 Farmer Marketplace
        </button>
      </div>

      {tab === 'farmer-marketplace' && <FarmerMarketplaceSection />}

      {/* Market summary stats */}
      {tab === 'prices' && !loading && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
          <StatPill icon="🌾" label="Tracked" value={summary.total} color="bg-slate-100 text-slate-600" />
          <StatPill icon="📈" label="Gainers" value={summary.gainers} color="bg-emerald-100 text-emerald-600" />
          <StatPill icon="📉" label="Decliners" value={summary.decliners} color="bg-error-light text-error" />
          <StatPill icon="➖" label="Unchanged" value={summary.unchanged} color="bg-gray-100 text-gray-500" />
        </div>
      )}

      {/* Top movers strip — advanced at-a-glance market signal */}
      {tab === 'prices' && !loading && (topMovers.gainers.length > 0 || topMovers.losers.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5">
            <p className="text-[11px] font-black uppercase tracking-wider text-emerald-700 mb-2 flex items-center gap-1.5">📈 Top Gainers</p>
            <div className="space-y-1.5">
              {topMovers.gainers.length === 0 ? (
                <p className="text-xs text-gray-400">No gainers right now.</p>
              ) : topMovers.gainers.map(({ item, pct }) => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700 truncate">{item.name}</span>
                  <span className="font-bold text-emerald-600 shrink-0 ml-2">+{pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-error/20 bg-error-light/50 p-3.5">
            <p className="text-[11px] font-black uppercase tracking-wider text-error-dark mb-2 flex items-center gap-1.5">📉 Top Decliners</p>
            <div className="space-y-1.5">
              {topMovers.losers.length === 0 ? (
                <p className="text-xs text-gray-400">No decliners right now.</p>
              ) : topMovers.losers.map(({ item, pct }) => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700 truncate">{item.name}</span>
                  <span className="font-bold text-error shrink-0 ml-2">{pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'prices' && (
      <>
      {/* Toolbar — search, filters, sort, view + export */}
      <div className="sticky top-16 z-10 bg-gray-50/90 backdrop-blur-sm py-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:bg-transparent sm:backdrop-blur-none sm:static mb-4">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2.5 flex flex-col lg:flex-row gap-2.5">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10.5A6.5 6.5 0 114 10.5a6.5 6.5 0 0113 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search commodities…"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <option value="">All locations</option>
              {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
            </select>
            <select
              value={marketTypeFilter}
              onChange={(e) => setMarketTypeFilter(e.target.value as '' | 'RETAIL' | 'WHOLESALE')}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <option value="">Retail &amp; Wholesale</option>
              <option value="RETAIL">Retail only</option>
              <option value="WHOLESALE">Wholesale only</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <option value="name">Sort: Name (A–Z)</option>
              <option value="price_asc">Sort: Price (Low–High)</option>
              <option value="price_desc">Sort: Price (High–Low)</option>
              <option value="change_desc">Sort: Biggest Gainers</option>
              <option value="change_asc">Sort: Biggest Decliners</option>
            </select>

            {/* View toggle */}
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 shrink-0">
              <button
                onClick={() => setView('grid')}
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                className={`p-1.5 rounded-md transition-colors ${view === 'grid' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2}/><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2}/><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2}/><rect x="14" y="14" width="7" height="7" rx="1" strokeWidth={2}/></svg>
              </button>
              <button
                onClick={() => setView('table')}
                aria-label="Table view"
                aria-pressed={view === 'table'}
                className={`p-1.5 rounded-md transition-colors ${view === 'table' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M3 6h18M3 18h18" /></svg>
              </button>
            </div>

            <button
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:border-red-300 hover:text-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
              Export CSV
            </button>
          </div>
        </div>

        {hasActiveFilters && (
          <p className="text-xs text-gray-400 mt-2 px-1">
            Showing <span className="font-semibold text-gray-600">{filtered.length}</span> of {items.length} commodities
            <button onClick={() => { setSearch(''); setLocationFilter(''); setMarketTypeFilter(''); }} className="ml-2 text-red-600 hover:text-red-700 font-semibold">
              Clear filters
            </button>
          </p>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <p className="text-4xl mb-2">🌾</p>
          <p className="text-sm">
            {items.length === 0 ? "Prices haven't been published yet — check back soon." : 'No commodities match your search or filters.'}
          </p>
        </div>
      ) : view === 'table' ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-[11px] font-black uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2.5">Commodity</th>
                <th className="px-4 py-2.5">Price</th>
                <th className="px-4 py-2.5">Change</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50/70 transition-colors">
                  <td className="px-4 py-2.5">
                    <p className="font-bold text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-400">per {item.unit}</p>
                  </td>
                  <td className="px-4 py-2.5 font-black text-gray-900 tabular-nums whitespace-nowrap">{formatUGX(item.price)}</td>
                  <td className="px-4 py-2.5"><TrendBadge item={item} size="xs" /></td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${item.marketType === 'WHOLESALE' ? 'bg-premium-navy/10 text-premium-navy' : 'bg-red-100 text-red-700'}`}>
                      {item.marketType === 'WHOLESALE' ? 'Wholesale' : 'Retail'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">{item.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((item) => (
            <div key={item.id} className="group relative flex flex-col overflow-hidden rounded-xl bg-white border border-gray-100 shadow-sm p-4 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-red-100">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center text-lg shrink-0">
                  <span aria-hidden="true">{iconFor(item.name)}</span>
                </div>
                <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${item.marketType === 'WHOLESALE' ? 'bg-premium-navy/10 text-premium-navy' : 'bg-red-100 text-red-700'}`}>
                  {item.marketType === 'WHOLESALE' ? 'Wholesale' : 'Retail'}
                </span>
              </div>
              <h3 className="font-bold text-gray-900 text-sm leading-tight truncate" title={item.name}>{item.name}</h3>
              <p className="text-xs text-gray-400 mb-2">per {item.unit}</p>
              <p className="text-xl font-black text-red-600 tabular-nums leading-none">{formatUGX(item.price)}</p>
              <div className="flex items-center justify-between mt-2.5">
                <TrendBadge item={item} />
                {item.location && (
                  <span className="flex items-center gap-1 text-xs text-gray-400 truncate max-w-[110px]">
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    {item.location}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-8 text-center">
        Prices are indicative retail/wholesale figures for common Uganda markets and are updated periodically by our team — treat them as a guide, not a live trading feed.
      </p>
      </>
      )}
    </div>
  );
}

export default function MarketPricesPage() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-4 py-5 text-center text-gray-400 text-sm">Loading market prices…</div>}>
      <MarketPricesContent />
    </Suspense>
  );
}
