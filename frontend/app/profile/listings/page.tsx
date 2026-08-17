'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Listing, Placement, SellerSubscription } from '@/lib/types';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { formatCurrency, formatDate, resolveImageUrl } from '@/lib/utils';
import { Breadcrumb } from '@/components/ui/Breadcrumb';

function getStatusClasses(status: Listing['status']) {
  if (status === 'ACTIVE') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'PENDING') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'SOLD') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (status === 'HIDDEN') return 'bg-gray-100 text-gray-600 border-gray-200';
  if (status === 'REJECTED') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

function getCountryBadge(listingCountry: Listing['country']) {
  if (listingCountry === 'UAE') return { label: 'United Arab Emirates', short: 'UAE', flag: 'AE' };
  if (listingCountry === 'KENYA') return { label: 'Kenya', short: 'Kenya', flag: 'KE' };
  if (listingCountry === 'CHINA') return { label: 'China', short: 'China', flag: 'CN' };
  return { label: 'Uganda', short: 'Uganda', flag: 'UG' };
}

const NON_EDITABLE_STATUSES: Listing['status'][] = ['PENDING', 'REJECTED', 'EXPIRED'];

const PLACEMENT_LABELS: Record<Placement, string> = {
  NONE: 'No placement',
  LATEST_COLLECTIONS: '⭐ Latest Collections',
  FEATURED_DEAL: '🔥 Featured Deal',
  FLASH_SALE: '⚡ Flash Sale',
};

const PLACEMENT_COLORS: Record<Placement, string> = {
  NONE: 'bg-gray-100 text-gray-600',
  LATEST_COLLECTIONS: 'bg-sky-100 text-sky-700',
  FEATURED_DEAL: 'bg-amber-100 text-amber-700',
  FLASH_SALE: 'bg-red-100 text-red-700',
};

interface ListingAnalytics {
  views: number;
}

export default function MyListingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [listings, setListings] = useState<Listing[]>([]);
  const [subscription, setSubscription] = useState<SellerSubscription | null | undefined>(undefined);
  const [hasActiveRental, setHasActiveRental] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [analytics, setAnalytics] = useState<Record<string, ListingAnalytics>>({});
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [updatingPlacement, setUpdatingPlacement] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkPlacement, setBulkPlacement] = useState<Placement>('NONE');
  const [applyingBulk, setApplyingBulk] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
    if (user) {
      Promise.all([
        api.get('/listings?mine=true&limit=100'),
        api.get('/packages/my-subscription?scope=LISTING').catch(() => ({ data: { subscription: null } })),
        api.get('/store-rentals/my').catch(() => ({ data: { rental: null } })),
      ])
        .then(([listingsRes, subRes, rentalRes]) => {
          setListings(listingsRes.data.listings || []);
          setSubscription(subRes.data.subscription);
          const rental = rentalRes.data.rental;
          setHasActiveRental(!!(rental && rental.status === 'ACTIVE' && new Date(rental.endDate) > new Date()));
        })
        .catch(() => {})
        .finally(() => setFetching(false));
    }
  }, [user, loading, router]);

  const handleStatusChange = async (listingId: string, newStatus: string) => {
    setUpdatingStatus(listingId);
    try {
      const { data } = await api.patch(`/listings/${listingId}/status`, { status: newStatus });
      setListings((prev) => prev.map((l) => l.id === listingId ? { ...l, status: data.listing.status } : l));
      showMsg('success', 'Status updated');
    } catch {
      showMsg('error', 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handlePlacementChange = async (listingId: string, newPlacement: Placement) => {
    setUpdatingPlacement(listingId);
    try {
      const { data } = await api.patch(`/listings/${listingId}/placement`, { placement: newPlacement });
      setListings((prev) => prev.map((l) => l.id === listingId ? { ...l, placement: data.listing.placement } : l));
      showMsg('success', 'Placement updated');
    } catch {
      showMsg('error', 'Failed to update placement');
    } finally {
      setUpdatingPlacement(null);
    }
  };

  const handleDelete = async (listingId: string) => {
    if (!confirm('Delete this listing? This cannot be undone.')) return;
    setDeletingId(listingId);
    try {
      await api.delete(`/listings/${listingId}`);
      setListings((prev) => prev.filter((l) => l.id !== listingId));
      showMsg('success', 'Listing deleted');
    } catch {
      showMsg('error', 'Failed to delete listing');
    } finally {
      setDeletingId(null);
    }
  };

  const loadAnalytics = async (listingId: string) => {
    if (analytics[listingId]) return;
    try {
      const { data } = await api.get(`/listings/${listingId}/analytics`);
      setAnalytics((prev) => ({ ...prev, [listingId]: { views: data.views } }));
    } catch {
      // silently ignore
    }
  };

  const handleBulkPlacement = async () => {
    const activeListings = listings.filter((l) => l.status === 'ACTIVE');
    if (activeListings.length === 0) { showMsg('error', 'No active listings to update'); return; }
    if (!confirm(`Apply "${PLACEMENT_LABELS[bulkPlacement]}" to all ${activeListings.length} active listings?`)) return;
    setApplyingBulk(true);
    try {
      await Promise.all(activeListings.map((l) =>
        api.patch(`/listings/${l.id}/placement`, { placement: bulkPlacement })
      ));
      setListings((prev) => prev.map((l) =>
        l.status === 'ACTIVE' ? { ...l, placement: bulkPlacement } : l
      ));
      showMsg('success', `Bulk placement applied to ${activeListings.length} listings`);
    } catch {
      showMsg('error', 'Some placements failed. Please try again.');
    } finally {
      setApplyingBulk(false);
    }
  };

  const daysLeft = subscription
    ? Math.max(0, Math.ceil((new Date(subscription.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  if (loading || fetching) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'My Profile', href: '/profile' },
          { label: 'My Listings' },
        ]}
      />

      {/* Action feedback */}
      {actionMsg && (
        <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${actionMsg.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {actionMsg.text}
        </div>
      )}

      <section className="overflow-hidden rounded-3xl bg-gradient-to-r from-premium-navy via-sky-600 to-sky-400 px-5 py-5 text-white shadow-xl sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/85">
              Seller Products
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight">My Listings</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/85 sm:text-base">
              Create, edit, update status, and control where each listing appears on the marketplace.
            </p>
          </div>
          <Link href="/listings/create" className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-bold text-premium-navy transition-colors hover:bg-sky-50">
            + Post New Listing
          </Link>
        </div>
      </section>

      {/* Subscription status banner */}
      {user?.role !== 'ADMIN' && (
        <div className={`mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border px-5 py-4 ${
          !subscription
            ? 'bg-amber-50 border-amber-200'
            : daysLeft <= 3
            ? 'bg-red-50 border-red-200'
            : 'bg-emerald-50 border-emerald-200'
        }`}>
          <div className="flex-1">
            {!subscription ? (
              <>
                <p className="text-sm font-semibold text-amber-800">⚠️ No active subscription</p>
                <p className="text-xs text-amber-600 mt-0.5">You need an active package to post listings.</p>
              </>
            ) : daysLeft <= 3 ? (
              <>
                <p className="text-sm font-semibold text-red-800">⏰ Subscription expiring soon</p>
                <p className="text-xs text-red-600 mt-0.5">
                  {`Your "${subscription.package.name}" package expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${formatDate(subscription.endDate)}).`}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-emerald-800">✓ Active: {subscription.package.name}</p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining · expires {formatDate(subscription.endDate)}
                  {subscription.package.maxListings != null && ` · ${listings.length}/${subscription.package.maxListings} listings used`}
                </p>
              </>
            )}
          </div>
          <Link
            href="/profile/subscription"
            className={`shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              !subscription || daysLeft <= 3
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            {!subscription ? 'Choose a Plan' : 'Manage Subscription'}
          </Link>
        </div>
      )}

      {/* Promote CTA: visible when user has NO active rental and has active listings */}
      {!hasActiveRental && user?.role !== 'ADMIN' && listings.some((l) => l.status === 'ACTIVE') && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-5 py-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-violet-800">🚀 Promote Your Listings</p>
            <p className="text-xs text-violet-600 mt-0.5">
              Get a Digital Store to feature your products in <strong>Latest Collections</strong>, <strong>Featured Deal</strong>, and <strong>Flash Sales</strong> sections — seen by thousands of buyers daily.
            </p>
          </div>
          <Link
            href="/dashboard/store-rental"
            className="shrink-0 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 transition-colors shadow-sm whitespace-nowrap"
          >
            Get a Digital Store →
          </Link>
        </div>
      )}

      {/* Bulk placement (only for active rental users) */}
      {hasActiveRental && listings.some((l) => l.status === 'ACTIVE') && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-indigo-800">🎯 Bulk Placement</p>
            <p className="text-xs text-indigo-600 mt-0.5">Apply a placement to all active listings at once.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={bulkPlacement}
              onChange={(e) => setBulkPlacement(e.target.value as Placement)}
              className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {(Object.keys(PLACEMENT_LABELS) as Placement[]).map((p) => (
                <option key={p} value={p}>{PLACEMENT_LABELS[p]}</option>
              ))}
            </select>
            <button
              onClick={handleBulkPlacement}
              disabled={applyingBulk}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {applyingBulk ? 'Applying…' : 'Apply to All'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-white/60 bg-white/95 p-5 shadow-sm sm:p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">All Listings</h2>
            <p className="mt-1 text-sm text-slate-500">Edit, update status, and manage placement for each listing.</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{listings.length}</span> listing{listings.length === 1 ? '' : 's'}
            {subscription?.package.maxListings != null && (
              <span className="text-slate-400"> / {subscription.package.maxListings} max</span>
            )}
          </div>
        </div>

        {listings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
            <h3 className="text-lg font-bold text-slate-900">No listings yet</h3>
            <p className="mt-2 text-sm text-slate-500">Start by creating your first listing.</p>
            <Link href="/listings/create" className="mt-5 inline-flex rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-600">
              Post Your First Listing
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {listings.map((listing) => {
              const country = getCountryBadge(listing.country);
              const listingAnalytics = analytics[listing.id];
              return (
                <article key={listing.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col sm:flex-row">
                    {/* Image */}
                    <div className="relative h-40 w-full shrink-0 bg-slate-100 sm:h-auto sm:w-40">
                      {listing.images?.[0] ? (
                        <Image src={resolveImageUrl(listing.images[0])} alt={listing.title} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm font-medium text-slate-400">No image</div>
                      )}
                      <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-white/80 bg-white/95 px-2 py-0.5 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-sm">
                        {country.short}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 flex-col p-4">
                      {/* Badges row */}
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getStatusClasses(listing.status)}`}>
                          {listing.status}
                        </span>
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                          {listing.category?.name || 'Uncategorized'}
                        </span>
                        {listing.placement && listing.placement !== 'NONE' && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLACEMENT_COLORS[listing.placement]}`}>
                            📍 {PLACEMENT_LABELS[listing.placement]}
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 line-clamp-1">{listing.title}</h3>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">{formatCurrency(listing.price, listing.currency)}</p>

                      {/* Analytics row */}
                      <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                        <span>👁 {listingAnalytics?.views ?? listing.views} views</span>
                        {!listingAnalytics && (
                          <button
                            type="button"
                            onClick={() => loadAnalytics(listing.id)}
                            className="text-sky-600 hover:underline text-xs"
                          >
                            Load analytics
                          </button>
                        )}
                        <span className="text-slate-400">{formatDate(listing.createdAt)}</span>
                      </div>

                      {/* Controls */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {/* Status selector */}
                        <select
                          value={listing.status}
                          onChange={(e) => handleStatusChange(listing.id, e.target.value)}
                          disabled={updatingStatus === listing.id || NON_EDITABLE_STATUSES.includes(listing.status)}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="SOLD">Sold</option>
                          <option value="HIDDEN">Hidden</option>
                          {listing.status === 'PENDING' && <option value="PENDING" disabled>Pending Review</option>}
                          {listing.status === 'REJECTED' && <option value="REJECTED" disabled>Rejected</option>}
                          {listing.status === 'EXPIRED' && <option value="EXPIRED" disabled>Expired</option>}
                        </select>

                        {/* Placement selector (only for users with active rental) */}
                        {(hasActiveRental || user?.role === 'ADMIN') && (
                          <select
                            value={listing.placement || 'NONE'}
                            onChange={(e) => handlePlacementChange(listing.id, e.target.value as Placement)}
                            disabled={updatingPlacement === listing.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
                          >
                            {(Object.keys(PLACEMENT_LABELS) as Placement[]).map((p) => (
                              <option key={p} value={p}>{PLACEMENT_LABELS[p]}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={`/listings/${listing.id}`}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          View
                        </Link>
                        <Link
                          href={`/listings/create?edit=${listing.id}`}
                          className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-600"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleDelete(listing.id)}
                          disabled={deletingId === listing.id}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === listing.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
