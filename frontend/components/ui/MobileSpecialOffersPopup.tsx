'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';
import { useCountry } from '@/context/CountryContext';
import { useCart } from '@/context/CartContext';
import { useSiteConfig } from '@/context/SiteConfigContext';
import { CurrencyDisplay } from '@/components/ui/CurrencyDisplay';
import { QuickAddButton } from '@/components/listings/QuickAddButton';
import type { Listing } from '@/lib/types';

// A "revisit" auto-open is offered once this many hours have passed since
// the popup last auto-showed itself - long enough to not nag someone
// browsing across several pages in one sitting, short enough to greet them
// again on a genuinely new visit.
const REVISIT_WINDOW_HOURS = 12;
// Storage keys kept from the original "Special Finds" name for backward
// compatibility with anyone's existing localStorage — renaming these would
// just make every returning visitor look like a first-time visitor again,
// which defeats the point of the revisit/new-item tracking below. The
// tracked id set now spans both Special Offers and Back to School listings
// (see HighlightItem below), not just discounted ones.
const SEEN_IDS_KEY = 'piitrade:specialFinds:seenListingIds';
const LAST_SHOWN_KEY = 'piitrade:specialFinds:lastShownAt';
const VISITED_KEY = 'piitrade:specialFinds:visited';

function discountPercent(listing: Listing): number {
  if (!listing.originalPrice || listing.originalPrice <= listing.price) return 0;
  return Math.round(((listing.originalPrice - listing.price) / listing.originalPrice) * 100);
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable (private mode, etc.) — auto-open just won't
    // persist across visits; the manual toggle button still works fine.
  }
}

interface HighlightItem {
  listing: Listing;
  kind: 'offer' | 'backToSchool';
}

/**
 * Mobile-only floating popup. Collapsed by default it's just a small round
 * icon docked above the bottom nav; tapping it expands a sheet highlighting
 * two admin-controlled sections: Special Offers (listings discounted at
 * least `specialOffers.minDiscountPercent`) and Back to School (listings an
 * admin has placed in that section — see BackToSchoolSection.tsx). Closes
 * back down to the icon on a second tap or a backdrop tap.
 *
 * Auto-open additionally pops the sheet open by itself, once per page load,
 * whenever there's at least one qualifying listing in either section AND
 * any of these hold:
 *   - this is the shopper's first-ever visit to the site;
 *   - it's a fresh revisit (more than REVISIT_WINDOW_HOURS since it last
 *     auto-showed);
 *   - new qualifying listings have been added to either pool since the
 *     shopper last saw it.
 *
 * Special Offers is admin-gated via siteConfig.specialOffers.enabled (see
 * /admin/settings → "Special Offers"); Back to School has its own
 * independent enable/timing switch resolved server-side by
 * GET /listings/back-to-school (see /admin/settings → "Back to School").
 * The component renders nothing at all — not even the collapsed icon — only
 * when Special Offers is off AND Back to School has no listings.
 */
export default function MobileSpecialOffersPopup() {
  const { country, currency: displayCurrency } = useCountry();
  const { totalItems } = useCart();
  const { specialOffers } = useSiteConfig();
  const [expanded, setExpanded] = useState(false);
  const [offerListings, setOfferListings] = useState<Listing[]>([]);
  const [backToSchoolListings, setBackToSchoolListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const autoOpenCheckedRef = useRef(false);

  const minDiscountPercent = specialOffers.minDiscountPercent;

  const loadOffers = useCallback(() => {
    if (fetched) return;
    setLoading(true);

    const offersRequest = specialOffers.enabled
      ? api.get('/listings/flash-sales', { params: { country, limit: 40 } })
          .then(({ data }) => (data.listings || []) as Listing[])
          .catch(() => [] as Listing[])
      : Promise.resolve([] as Listing[]);

    const backToSchoolRequest = api
      .get('/listings/back-to-school', { params: { country, limit: 20 } })
      .then(({ data }) => (data.listings || []) as Listing[])
      .catch(() => [] as Listing[]);

    Promise.all([offersRequest, backToSchoolRequest]).then(([offers, backToSchool]) => {
      setOfferListings(offers.filter((l) => discountPercent(l) >= minDiscountPercent));
      setBackToSchoolListings(backToSchool);
      setLoading(false);
      setFetched(true);
    });
  }, [country, fetched, specialOffers.enabled, minDiscountPercent]);

  // Refresh both pools whenever the shopper switches country/market.
  useEffect(() => {
    setFetched(false);
    autoOpenCheckedRef.current = false;
  }, [country]);

  // Always load both pools up front (not just lazily on tap) so the
  // auto-open decision below has real data to react to.
  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  // Decide, once per fetch, whether to auto-open.
  useEffect(() => {
    if (!fetched || autoOpenCheckedRef.current) return;
    autoOpenCheckedRef.current = true;

    const currentIds = [...offerListings.map((l) => l.id), ...backToSchoolListings.map((l) => l.id)].sort();
    if (currentIds.length === 0) return;

    const isFirstVisit = readLocal(VISITED_KEY) === null;

    const lastShownRaw = readLocal(LAST_SHOWN_KEY);
    const lastShown = lastShownRaw ? Number(lastShownRaw) : 0;
    const hoursSinceShown = lastShown ? (Date.now() - lastShown) / (1000 * 60 * 60) : Infinity;
    const isRevisit = !isFirstVisit && hoursSinceShown >= REVISIT_WINDOW_HOURS;

    const seenIdsRaw = readLocal(SEEN_IDS_KEY);
    let seenIds: string[] = [];
    if (seenIdsRaw) {
      try {
        seenIds = JSON.parse(seenIdsRaw);
      } catch {
        seenIds = [];
      }
    }
    const hasNewListings = currentIds.some((id) => !seenIds.includes(id));

    writeLocal(VISITED_KEY, '1');

    if (isFirstVisit || isRevisit || hasNewListings) {
      setExpanded(true);
      writeLocal(LAST_SHOWN_KEY, String(Date.now()));
      writeLocal(SEEN_IDS_KEY, JSON.stringify(currentIds));
    }
  }, [fetched, offerListings, backToSchoolListings]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadOffers();
  };

  // Nothing to highlight at all: Special Offers is off and Back to School
  // has no listings. Hide the popup entirely — collapsed icon included.
  if (!specialOffers.enabled && backToSchoolListings.length === 0 && fetched) return null;
  // Before the first fetch resolves, mirror the previous behavior and show
  // the icon whenever Special Offers is switched on (its own emptiness
  // state — "check back soon" — is handled once loaded).
  if (!specialOffers.enabled && !fetched) return null;

  const highlights: HighlightItem[] = [
    ...offerListings.map((listing): HighlightItem => ({ listing, kind: 'offer' })),
    ...backToSchoolListings.map((listing): HighlightItem => ({ listing, kind: 'backToSchool' })),
  ];

  return (
    <div className="sm:hidden">
      {/* Backdrop when expanded */}
      {expanded && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setExpanded(false)}
          aria-hidden="true"
        />
      )}

      {/* Collapsed icon (default state) / expand-toggle handle */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide special offers' : specialOffers.enabled ? `Show special offers of ${minDiscountPercent}% off and up` : 'Show back to school picks'}
        className="fixed z-50 bottom-20 right-4 w-12 h-12 rounded-full bg-red-600 text-white shadow-lg flex items-center justify-center border-2 border-white active:scale-95 transition-transform"
        style={{
          // Clears the persistent "View cart" bar (see MobileFloatingCartBar)
          // when it's showing, so the two floating controls never overlap.
          bottom: expanded
            ? undefined
            : totalItems > 0
            ? 'calc(9rem + env(safe-area-inset-bottom, 0px))'
            : 'calc(5rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {expanded ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : specialOffers.enabled ? (
          <span className="flex flex-col items-center leading-none">
            <span className="text-[13px] font-black">%</span>
            <span className="text-[7px] font-bold tracking-tight">{minDiscountPercent}%+</span>
          </span>
        ) : (
          <span className="text-lg leading-none">🎒</span>
        )}
      </button>

      {/* Expanded sheet — cream banner header with a bold "up to X% off"
          chip when Special Offers is on, close (X) button top-left, then a
          vertical list of highlighted listings (image, name, quick facts,
          discount chip for Special Offers items) rather than a grid. Back
          to School items get their own small section beneath, so the two
          admin-controlled sections stay visually distinct even though
          they're surfaced together. */}
      {expanded && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] bg-white rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="relative bg-[var(--theme-bg-light)] px-4 pt-4 pb-5">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close special offers"
              className="absolute top-3 left-3 w-8 h-8 rounded-full bg-white shadow flex items-center justify-center text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="pt-9 flex flex-col items-start gap-1.5">
              <p className="text-2xl font-black text-gray-900 leading-none">Special Offers</p>
              {specialOffers.enabled && (
                <span className="inline-block bg-gray-900 text-lime-300 font-black text-sm px-3 py-1 rounded-md -rotate-1">
                  up to {minDiscountPercent}%+ off
                </span>
              )}
              <p className="text-[12px] text-gray-500 mt-0.5">Discover deep discounts and season picks</p>
            </div>
          </div>

          <div className="overflow-y-auto px-3 py-3 divide-y divide-gray-50">
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3 py-3">
                  <div className="w-20 h-20 shrink-0 rounded-xl bg-gray-100 animate-pulse" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 w-2/3 bg-gray-100 rounded animate-pulse" />
                    <div className="h-3 w-1/3 bg-gray-100 rounded animate-pulse" />
                  </div>
                </div>
              ))}

            {!loading && highlights.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">No offers right now — check back soon.</p>
            )}

            {!loading &&
              highlights.map(({ listing, kind }) => {
                const img = listing.productImages?.find((i) => i.cdnUrl)?.cdnUrl ?? listing.images?.[0] ?? null;
                const pct = discountPercent(listing);
                return (
                  <div key={`${kind}-${listing.id}`} className="relative flex gap-3 py-3">
                    <Link href={`/listings/${listing.id}`} onClick={() => setExpanded(false)} className="flex gap-3 flex-1 min-w-0">
                      <div className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-gray-50">
                        {resolveImageUrl(img) ? (
                          <Image src={resolveImageUrl(img)!} alt={listing.title} fill className="object-cover" sizes="80px" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-[10px]">No image</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="text-sm font-bold text-gray-900 truncate pr-8">{listing.title}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5 truncate">{listing.category?.name} · {listing.location}</p>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <CurrencyDisplay
                            amount={listing.price}
                            currency={listing.currency}
                            displayCurrency={displayCurrency}
                            className="text-red-600 font-extrabold text-sm leading-none"
                          />
                          {kind === 'offer' && listing.originalPrice != null && (
                            <CurrencyDisplay
                              amount={listing.originalPrice}
                              currency={listing.currency}
                              displayCurrency={displayCurrency}
                              className="text-gray-400 line-through text-[11px] leading-none"
                            />
                          )}
                        </div>
                        {kind === 'offer' ? (
                          <span className="inline-block mt-1.5 bg-lime-300 text-gray-900 text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">
                            Save {pct}% off
                          </span>
                        ) : (
                          <span className="inline-block mt-1.5 bg-amber-200 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">
                            🎒 Back to School
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="absolute bottom-0.5 right-0">
                      <QuickAddButton listing={listing} size="sm" />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
