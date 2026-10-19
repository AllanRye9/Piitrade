'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Listing, Placement } from '@/lib/types';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { formatCurrency, formatDate, resolveImageUrl } from '@/lib/utils';
import { T } from '@/components/ui/T';
import { useTr } from '@/lib/i18n/useTr';
import { useSubscriptionOverview, effectiveRentalState } from '@/lib/subscriptionStatus';
import { SubscriptionStatusStrip, RentalStatusStrip } from '@/components/account/SubscriptionStatusCard';

function getStatusClasses(status: Listing['status']) {
  if (status === 'ACTIVE') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'PENDING') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'SOLD') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (status === 'HIDDEN') return 'bg-gray-100 text-gray-600 border-gray-200';
  if (status === 'REJECTED') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

function getCountryBadge(listingCountry: Listing['country']) {
  void listingCountry;
  return { label: 'Uganda', short: 'Uganda', flag: 'UG' };
}

const NON_EDITABLE_STATUSES: Listing['status'][] = ['PENDING', 'REJECTED', 'EXPIRED'];

const PLACEMENT_LABELS: Record<Placement, string> = {
  NONE: 'No placement',
  LATEST_COLLECTIONS: '⭐ Latest Collections',
  FEATURED_DEAL: '🔥 Featured Deal',
  FLASH_SALE: '⚡ Flash Deal',
  BACK_TO_SCHOOL: '🎒 Back to School',
};

const PLACEMENT_COLORS: Record<Placement, string> = {
  NONE: 'bg-gray-100 text-gray-600',
  LATEST_COLLECTIONS: 'bg-sky-100 text-sky-700',
  FEATURED_DEAL: 'bg-amber-100 text-amber-700',
  FLASH_SALE: 'bg-red-100 text-red-700',
  BACK_TO_SCHOOL: 'bg-orange-100 text-orange-700',
};

interface ListingAnalytics {
  views: number;
}

type SortKey = 'newest' | 'oldest' | 'price_desc' | 'price_asc' | 'views' | 'title';
type StatusFilter = 'ALL' | Listing['status'];

export default function MyListingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const tr = useTr();
  const [listings, setListings] = useState<Listing[]>([]);
  const [rental, setRental] = useState<{ status: string; endDate: string; tier?: string } | null>(null);
  const hasActiveRental = effectiveRentalState(rental) === 'ACTIVE';
  const overview = useSubscriptionOverview('LISTING', !!user);
  const subscription = overview.current;
  const [fetching, setFetching] = useState(true);
  const [analytics, setAnalytics] = useState<Record<string, ListingAnalytics>>({});
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [updatingPlacement, setUpdatingPlacement] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filtering / sorting / view state
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [placementFilter, setPlacementFilter] = useState<'' | Placement>('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [cols, setCols] = useState<number>(3);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPlacement, setBulkPlacement] = useState<Placement>('NONE');

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  }, []);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem('myListingsView');
      if (v === 'grid' || v === 'table') setView(v);
    } catch { /* ignore */ }
  }, []);
  const changeView = (v: 'table' | 'grid') => {
    setView(v);
    try { window.localStorage.setItem('myListingsView', v); } catch { /* ignore */ }
  };

  // Columns-per-row preference: instant from localStorage, then synced to the
  // account (GET/PUT /users/me/preferences) so it follows the user across devices.
  const changeCols = (n: number) => {
    setCols(n);
    changeView('grid');
    try { window.localStorage.setItem('myListingsCols', String(n)); } catch { /* ignore */ }
    api.put('/users/me/preferences', { listingColumns: n }).catch(() => { /* local copy still applies */ });
  };
  useEffect(() => {
    try {
      const c = Number(window.localStorage.getItem('myListingsCols'));
      if (c >= 1 && c <= 6) setCols(c);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!user) return;
    api.get('/users/me/preferences')
      .then(({ data }) => {
        const n = data?.preferences?.listingColumns;
        if (typeof n === 'number' && n >= 1 && n <= 6) {
          setCols(n);
          try { window.localStorage.setItem('myListingsCols', String(n)); } catch { /* ignore */ }
        }
      })
      .catch(() => { /* keep local value */ });
  }, [user]);

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
    if (user) {
      Promise.all([
        api.get('/listings?mine=true&limit=100'),
        api.get('/store-rentals/my').catch(() => ({ data: { rental: null } })),
      ])
        .then(([listingsRes, rentalRes]) => {
          setListings(listingsRes.data.listings || []);
          setRental(rentalRes.data.rental ?? null);
        })
        .catch(() => {})
        .finally(() => setFetching(false));
    }
  }, [user, loading, router]);

  const canPlace = hasActiveRental || user?.role === 'ADMIN';

  const handleStatusChange = async (listingId: string, newStatus: string) => {
    setUpdatingStatus(listingId);
    try {
      const { data } = await api.patch(`/listings/${listingId}/status`, { status: newStatus });
      setListings((prev) => prev.map((l) => l.id === listingId ? { ...l, status: data.listing.status } : l));
      showMsg('success', tr('Status updated'));
    } catch {
      showMsg('error', tr('Failed to update status'));
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handlePlacementChange = async (listingId: string, newPlacement: Placement) => {
    setUpdatingPlacement(listingId);
    try {
      const { data } = await api.patch(`/listings/${listingId}/placement`, { placement: newPlacement });
      setListings((prev) => prev.map((l) => l.id === listingId ? { ...l, placement: data.listing.placement } : l));
      showMsg('success', tr('Placement updated'));
    } catch {
      showMsg('error', tr('Failed to update placement'));
    } finally {
      setUpdatingPlacement(null);
    }
  };

  const handleDelete = async (listingId: string) => {
    if (!confirm(tr('Delete this listing? This cannot be undone.'))) return;
    setDeletingId(listingId);
    try {
      await api.delete(`/listings/${listingId}`);
      setListings((prev) => prev.filter((l) => l.id !== listingId));
      setSelected((prev) => { const n = new Set(prev); n.delete(listingId); return n; });
      showMsg('success', tr('Listing deleted'));
    } catch {
      showMsg('error', tr('Failed to delete listing'));
    } finally {
      setDeletingId(null);
    }
  };

  const loadAnalytics = async (listingId: string) => {
    if (analytics[listingId]) return;
    try {
      const { data } = await api.get(`/listings/${listingId}/analytics`);
      setAnalytics((prev) => ({ ...prev, [listingId]: { views: data.views } }));
    } catch { /* silently ignore */ }
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: listings.length };
    for (const l of listings) c[l.status] = (c[l.status] || 0) + 1;
    return c;
  }, [listings]);

  const totalViews = useMemo(() => listings.reduce((s, l) => s + (analytics[l.id]?.views ?? l.views ?? 0), 0), [listings, analytics]);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const l of listings) if (l.category?.name) names.add(l.category.name);
    return [...names].sort();
  }, [listings]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const min = priceMin ? Number(priceMin) : null;
    const max = priceMax ? Number(priceMax) : null;
    const list = listings.filter((l) => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
      if (categoryFilter && l.category?.name !== categoryFilter) return false;
      if (placementFilter && (l.placement || 'NONE') !== placementFilter) return false;
      if (min !== null && l.price < min) return false;
      if (max !== null && l.price > max) return false;
      if (term && !(l.title.toLowerCase().includes(term) || (l.category?.name ?? '').toLowerCase().includes(term) || (l.location ?? '').toLowerCase().includes(term))) return false;
      return true;
    });
    list.sort((a, b) => {
      switch (sort) {
        case 'oldest': return +new Date(a.createdAt) - +new Date(b.createdAt);
        case 'price_desc': return b.price - a.price;
        case 'price_asc': return a.price - b.price;
        case 'views': return (analytics[b.id]?.views ?? b.views ?? 0) - (analytics[a.id]?.views ?? a.views ?? 0);
        case 'title': return a.title.localeCompare(b.title);
        default: return +new Date(b.createdAt) - +new Date(a.createdAt);
      }
    });
    return list;
  }, [listings, q, statusFilter, categoryFilter, placementFilter, priceMin, priceMax, sort, analytics]);

  const filtersActive = !!(q || statusFilter !== 'ALL' || categoryFilter || placementFilter || priceMin || priceMax);
  const clearFilters = () => { setQ(''); setStatusFilter('ALL'); setCategoryFilter(''); setPlacementFilter(''); setPriceMin(''); setPriceMax(''); };

  const visibleIds = visible.map((l) => l.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleIds));
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedListings = listings.filter((l) => selected.has(l.id));

  // ── Bulk tools ────────────────────────────────────────────────────────────
  const bulkStatus = async (status: 'ACTIVE' | 'SOLD' | 'HIDDEN') => {
    const targets = selectedListings.filter((l) => !NON_EDITABLE_STATUSES.includes(l.status) && l.status !== status);
    if (targets.length === 0) { showMsg('error', tr('Nothing to update — pending, rejected or expired listings cannot change status.')); return; }
    setBulkBusy(true);
    const results = await Promise.allSettled(targets.map((l) => api.patch(`/listings/${l.id}/status`, { status })));
    const ok = new Set(targets.filter((_, i) => results[i].status === 'fulfilled').map((l) => l.id));
    setListings((prev) => prev.map((l) => ok.has(l.id) ? { ...l, status } : l));
    setBulkBusy(false);
    showMsg(ok.size === targets.length ? 'success' : 'error', `${ok.size}/${targets.length} ${tr('updated')}`);
  };

  const bulkSetPlacement = async () => {
    const targets = selectedListings.filter((l) => l.status === 'ACTIVE');
    if (targets.length === 0) { showMsg('error', tr('Select active listings to change placement.')); return; }
    if (!confirm(`${tr('Apply')} "${tr(PLACEMENT_LABELS[bulkPlacement])}" → ${targets.length}?`)) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(targets.map((l) => api.patch(`/listings/${l.id}/placement`, { placement: bulkPlacement })));
    const ok = new Set(targets.filter((_, i) => results[i].status === 'fulfilled').map((l) => l.id));
    setListings((prev) => prev.map((l) => ok.has(l.id) ? { ...l, placement: bulkPlacement } : l));
    setBulkBusy(false);
    showMsg(ok.size === targets.length ? 'success' : 'error', `${ok.size}/${targets.length} ${tr('updated')}`);
  };

  const bulkDelete = async () => {
    if (selectedListings.length === 0) return;
    if (!confirm(`${tr('Delete')} ${selectedListings.length}? ${tr('This cannot be undone.')}`)) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(selectedListings.map((l) => api.delete(`/listings/${l.id}`)));
    const ok = new Set(selectedListings.filter((_, i) => results[i].status === 'fulfilled').map((l) => l.id));
    setListings((prev) => prev.filter((l) => !ok.has(l.id)));
    setSelected(new Set());
    setBulkBusy(false);
    showMsg(ok.size === selectedListings.length ? 'success' : 'error', `${ok.size}/${selectedListings.length} ${tr('deleted')}`);
  };

  const exportCsv = () => {
    const rows = (selectedListings.length ? selectedListings : visible);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Title', 'Status', 'Category', 'Price', 'Currency', 'Views', 'Placement', 'Location', 'Created', 'URL'].join(','),
      ...rows.map((l) => [l.title, l.status, l.category?.name, l.price, l.currency, analytics[l.id]?.views ?? l.views ?? 0, l.placement || 'NONE', l.location, l.createdAt, `${window.location.origin}/listings/${l.id}`].map(esc).join(',')),
    ];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `my-listings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyLink = async (id: string) => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/listings/${id}`); showMsg('success', tr('Link copied')); }
    catch { showMsg('error', tr('Could not copy link')); }
  };

  if (loading || fetching) return <div className="p-8 text-center text-gray-400"><T>Loading...</T></div>;

  const statusOptions = (l: Listing, disabled: boolean) => (
    <select
      value={l.status}
      onChange={(e) => handleStatusChange(l.id, e.target.value)}
      disabled={disabled}
      aria-label={tr('Status')}
      className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:opacity-50"
    >
      <option value="ACTIVE">{tr('Active')}</option>
      <option value="SOLD">{tr('Sold')}</option>
      <option value="HIDDEN">{tr('Hidden')}</option>
      {l.status === 'PENDING' && <option value="PENDING" disabled>{tr('Pending Review')}</option>}
      {l.status === 'REJECTED' && <option value="REJECTED" disabled>{tr('Rejected')}</option>}
      {l.status === 'EXPIRED' && <option value="EXPIRED" disabled>{tr('Expired')}</option>}
    </select>
  );

  const placementSelect = (l: Listing) => canPlace ? (
    <select
      value={l.placement || 'NONE'}
      onChange={(e) => handlePlacementChange(l.id, e.target.value as Placement)}
      disabled={updatingPlacement === l.id}
      aria-label={tr('Placement')}
      className="max-w-[9.5rem] rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-50"
    >
      {(Object.keys(PLACEMENT_LABELS) as Placement[]).map((p) => <option key={p} value={p}>{tr(PLACEMENT_LABELS[p])}</option>)}
    </select>
  ) : null;

  const rowActions = (l: Listing) => (
    <div className="flex items-center gap-1">
      <Link href={`/listings/${l.id}`} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"><T>View</T></Link>
      <Link href={`/listings/create?edit=${l.id}`} className="rounded-md bg-red-500 px-2 py-1 text-xs font-semibold text-white hover:bg-red-600"><T>Edit</T></Link>
      <button type="button" onClick={() => copyLink(l.id)} title={tr('Copy link')} aria-label={tr('Copy link')} className="rounded-md border border-slate-200 px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-50">🔗</button>
      <button type="button" onClick={() => handleDelete(l.id)} disabled={deletingId === l.id} title={tr('Delete')} aria-label={tr('Delete')} className="rounded-md border border-red-200 px-1.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">🗑</button>
    </div>
  );

  const thumb = (l: Listing, size: string) => (
    <div className={`relative shrink-0 overflow-hidden rounded-md bg-slate-100 ${size}`}>
      {l.images?.[0]
        ? <Image src={resolveImageUrl(l.images[0])} alt={l.title} fill className="object-cover" unoptimized />
        : <div className="flex h-full items-center justify-center text-[10px] text-slate-400"><T>No image</T></div>}
    </div>
  );

  const STATUS_TABS: StatusFilter[] = ['ALL', 'ACTIVE', 'PENDING', 'SOLD', 'HIDDEN', 'REJECTED', 'EXPIRED'];

  return (
    <div className="w-full px-2 sm:px-3 py-2">
      {/* Header row: title, stats, primary action */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-extrabold text-gray-900"><T>My Listings</T></h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span><b className="text-gray-900">{counts.ALL}</b> {tr('listings')}{subscription?.package.maxListings != null && <span className="text-gray-400"> / {subscription.package.maxListings} max</span>}</span>
          <span><b className="text-emerald-700">{counts.ACTIVE || 0}</b> {tr('Active')}</span>
          <span><b className="text-amber-700">{counts.PENDING || 0}</b> {tr('Pending')}</span>
          <span><b className="text-slate-700">{counts.SOLD || 0}</b> {tr('Sold')}</span>
          <span>👁 <b className="text-gray-900">{totalViews.toLocaleString()}</b></span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={exportCsv} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">⬇ CSV</button>
          <Link href="/listings/create" className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600">+ <T>Post New Listing</T></Link>
        </div>
      </div>

      {actionMsg && (
        <div role="status" className={`mb-2 rounded-lg px-3 py-2 text-sm font-medium ${actionMsg.type === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>
          {actionMsg.text}
        </div>
      )}

      {/* One-line subscription status with Renew */}
      {user?.role !== 'ADMIN' && (
        rental ? (
          <RentalStatusStrip className="mb-2" rental={rental} />
        ) : (
          <SubscriptionStatusStrip className="mb-2" overview={overview}>
            {listings.some((l) => l.status === 'ACTIVE') && (
              <Link href="/dashboard/store-rental" className="font-bold text-violet-700 underline underline-offset-2">🚀 {tr('Get a Web Store')}</Link>
            )}
          </SubscriptionStatusStrip>
        )
      )}

      {/* Filter / sort toolbar */}
      <div className="mb-2 rounded-xl border border-gray-100 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search title, category, location…')} aria-label={tr('Search my listings')}
              className="h-8 w-full rounded-lg border border-gray-200 pl-3 pr-7 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">✕</button>}
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label={tr('Category')} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700">
            <option value="">{tr('All categories')}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {canPlace && (
            <select value={placementFilter} onChange={(e) => setPlacementFilter(e.target.value as '' | Placement)} aria-label={tr('Placement')} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700">
              <option value="">{tr('Any placement')}</option>
              {(Object.keys(PLACEMENT_LABELS) as Placement[]).map((p) => <option key={p} value={p}>{tr(PLACEMENT_LABELS[p])}</option>)}
            </select>
          )}
          <input type="number" min={0} inputMode="numeric" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder={tr('Min price')} aria-label={tr('Min price')} className="h-8 w-24 rounded-lg border border-gray-200 px-2 text-xs" />
          <span className="text-gray-300">–</span>
          <input type="number" min={0} inputMode="numeric" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder={tr('Max price')} aria-label={tr('Max price')} className="h-8 w-24 rounded-lg border border-gray-200 px-2 text-xs" />
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={tr('Sort')} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs font-medium text-gray-700">
            <option value="newest">{tr('Newest first')}</option>
            <option value="oldest">{tr('Oldest first')}</option>
            <option value="price_desc">{tr('Price: High to Low')}</option>
            <option value="price_asc">{tr('Price: Low to High')}</option>
            <option value="views">{tr('Most viewed')}</option>
            <option value="title">{tr('Title A–Z')}</option>
          </select>
          {filtersActive && <button type="button" onClick={clearFilters} className="text-xs font-semibold text-red-600 underline underline-offset-2">{tr('Clear filters')}</button>}
          <div className="ml-auto inline-flex items-center rounded-lg bg-gray-100 p-0.5" role="group" aria-label={tr('View')}>
            <button type="button" onClick={() => changeView('table')} aria-pressed={view === 'table'} title={tr('List view')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${view === 'table' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500'}`}>☰</button>
            <span className="mx-1 hidden text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:inline">{tr('Per row')}</span>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} type="button" onClick={() => changeCols(n)} aria-pressed={view === 'grid' && cols === n}
                title={`${n} ${tr('per row')}`} aria-label={`${n} ${tr('per row')}`}
                className={`${n === 1 ? 'sm:hidden' : ''} ${n > 4 ? 'hidden xl:inline-block' : ''} min-w-[1.75rem] rounded-md px-1.5 py-1 text-xs font-bold ${view === 'grid' && cols === n ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STATUS_TABS.filter((s) => s === 'ALL' || counts[s]).map((s) => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusFilter === s ? 'border-red-500 bg-red-500 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-red-300'}`}>
              {s === 'ALL' ? tr('All') : tr(s.charAt(0) + s.slice(1).toLowerCase())} <span className="opacity-70">{counts[s] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-[calc(var(--sticky-offset,0px)+44px)] z-20 mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs shadow-sm">
          <span className="font-bold text-red-800">{selected.size} {tr('selected')}</span>
          <button disabled={bulkBusy} onClick={() => bulkStatus('ACTIVE')} className="rounded-md border border-emerald-300 bg-white px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">✓ {tr('Mark active')}</button>
          <button disabled={bulkBusy} onClick={() => bulkStatus('SOLD')} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{tr('Mark sold')}</button>
          <button disabled={bulkBusy} onClick={() => bulkStatus('HIDDEN')} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{tr('Hide')}</button>
          {canPlace && (
            <>
              <select value={bulkPlacement} onChange={(e) => setBulkPlacement(e.target.value as Placement)} className="rounded-md border border-rose-200 bg-white px-1.5 py-1">
                {(Object.keys(PLACEMENT_LABELS) as Placement[]).map((p) => <option key={p} value={p}>{tr(PLACEMENT_LABELS[p])}</option>)}
              </select>
              <button disabled={bulkBusy} onClick={bulkSetPlacement} className="rounded-md bg-rose-600 px-2 py-1 font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{tr('Apply placement')}</button>
            </>
          )}
          <button onClick={exportCsv} className="rounded-md border border-gray-300 bg-white px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50">⬇ CSV</button>
          <button disabled={bulkBusy} onClick={bulkDelete} className="rounded-md border border-red-300 bg-white px-2 py-1 font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">🗑 {tr('Delete')}</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto font-semibold text-gray-500 underline underline-offset-2">{tr('Clear selection')}</button>
        </div>
      )}

      {listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
          <h3 className="text-lg font-bold text-slate-900"><T>No listings yet</T></h3>
          <p className="mt-1 text-sm text-slate-500"><T>Start selling on Piitrade marketplace</T></p>
          <Link href="/listings/create" className="mt-4 inline-flex rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600"><T>Post Your First Ad</T></Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-8 text-center text-sm text-slate-500">
          <T>No listings found</T> · <button type="button" onClick={clearFilters} className="font-semibold text-red-600 underline">{tr('Clear filters')}</button>
        </div>
      ) : view === 'table' ? (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
          <table className="fill-table w-full min-w-[900px] text-left text-sm">
            <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-8 px-2 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={tr('Select all')} /></th>
                <th className="px-2 py-2"><T>Listing</T></th>
                <th className="px-2 py-2"><T>Status</T></th>
                <th className="px-2 py-2 text-right"><T>Price</T></th>
                <th className="px-2 py-2 text-right"><T>Views</T></th>
                {canPlace && <th className="px-2 py-2"><T>Placement</T></th>}
                <th className="px-2 py-2"><T>Posted</T></th>
                <th className="px-2 py-2 text-right"><T>Actions</T></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.map((l) => (
                <tr key={l.id} className={selected.has(l.id) ? 'bg-red-50/50' : 'hover:bg-gray-50/60'}>
                  <td className="px-2 py-1.5"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} aria-label={`${tr('Select')} ${l.title}`} /></td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      {thumb(l, 'h-10 w-10')}
                      <div className="min-w-0">
                        <p className="max-w-[320px] truncate font-semibold text-slate-900" title={l.title}>{l.title}</p>
                        <p className="truncate text-[11px] text-slate-500">{l.category?.name || tr('Uncategorized')}{l.location ? ` · ${l.location}` : ''}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col gap-1">
                      <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getStatusClasses(l.status)}`}>{l.status}</span>
                      {statusOptions(l, updatingStatus === l.id || NON_EDITABLE_STATUSES.includes(l.status))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-slate-800">{formatCurrency(l.price, l.currency)}</td>
                  <td className="px-2 py-1.5 text-right text-xs text-slate-600">
                    {analytics[l.id]?.views ?? l.views ?? 0}
                    {!analytics[l.id] && <button type="button" onClick={() => loadAnalytics(l.id)} title={tr('Load analytics')} className="ml-1 text-red-500">↻</button>}
                  </td>
                  {canPlace && <td className="px-2 py-1.5">{placementSelect(l)}</td>}
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-500">{formatDate(l.createdAt)}</td>
                  <td className="px-2 py-1.5"><div className="flex justify-end">{rowActions(l)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="grid gap-2 grid-cols-[repeat(var(--c-sm),minmax(0,1fr))] sm:grid-cols-[repeat(var(--c-md),minmax(0,1fr))] lg:grid-cols-[repeat(var(--c-lg),minmax(0,1fr))]"
          style={{
            ['--c-sm' as string]: Math.min(cols, 2),
            ['--c-md' as string]: Math.min(cols, 3),
            ['--c-lg' as string]: cols,
          }}
        >
          {visible.map((l) => {
            const country = getCountryBadge(l.country);
            return (
              <article key={l.id} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${selected.has(l.id) ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'}`}>
                <div className={`relative w-full bg-slate-100 ${cols >= 4 ? 'aspect-[4/3]' : 'h-36'}`}>
                  {l.images?.[0]
                    ? <Image src={resolveImageUrl(l.images[0])} alt={l.title} fill className="object-cover" unoptimized />
                    : <div className="flex h-full items-center justify-center text-sm text-slate-400"><T>No image</T></div>}
                  <label className="absolute left-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-white/95 shadow">
                    <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} aria-label={`${tr('Select')} ${l.title}`} />
                  </label>
                  <span className={`absolute right-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getStatusClasses(l.status)}`}>{l.status}</span>
                  <span className="absolute bottom-2 left-2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-slate-800 shadow-sm">{country.short}</span>
                </div>
                <div className="p-2.5">
                  <h3 className="truncate text-sm font-bold text-slate-900" title={l.title}>{l.title}</h3>
                  <p className="text-sm font-semibold text-slate-700">{formatCurrency(l.price, l.currency)}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="truncate">{l.category?.name || tr('Uncategorized')}</span>
                    <span>👁 {analytics[l.id]?.views ?? l.views ?? 0}</span>
                    <span className="ml-auto">{formatDate(l.createdAt)}</span>
                  </p>
                  {l.placement && l.placement !== 'NONE' && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${PLACEMENT_COLORS[l.placement]}`}>📍 {tr(PLACEMENT_LABELS[l.placement])}</span>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {statusOptions(l, updatingStatus === l.id || NON_EDITABLE_STATUSES.includes(l.status))}
                    {placementSelect(l)}
                  </div>
                  <div className="mt-2">{rowActions(l)}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {visible.length > 0 && <p className="mt-2 text-center text-xs text-gray-400">{visible.length} / {listings.length} {tr('listings')}</p>}
    </div>
  );
}
