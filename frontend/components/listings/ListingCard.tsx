'use client';

import { useTr } from '@/lib/i18n/useTr';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Listing } from '@/lib/types';
import { CurrencyDisplay } from '@/components/ui/CurrencyDisplay';
import { resolveImageUrl, isDirectContactCategory } from '@/lib/utils';
import { FavoriteButton } from './FavoriteButton';
import { AdminEditInlineButton } from './AdminEditInlineButton';
import { useCountry } from '@/context/CountryContext';
import { useAuth } from '@/context/AuthContext';
import { getListingBadges } from '@/lib/listingBadges';

interface Props {
  listing: Listing;
  showFavorite?: boolean;
  cleanImage?: boolean;
  /**
   * `next/image` `sizes` hint. Defaults to the 2-per-row-on-mobile grid
   * used by most listing pages (category/brand pages, "Other Collections",
   * search results). Callers that render this card inside the 3-per-row
   * homepage carousels (Recent Across Categories, Latest Collections) pass
   * a tighter value so the image optimizer doesn't fetch a file sized for
   * a wider card than what's actually on screen.
   */
  sizes?: string;
  /**
   * Smaller type, padding and fewer secondary lines on phones. Used by the one-row homepage
   * carousels (3 cards across a phone) so cards are not oversized; sm+ looks the same as normal.
   */
  compact?: boolean;
}

export function ListingCard({
  listing,
  showFavorite = true,
  cleanImage = false,
  sizes,
  compact = false,
}: Props) {
  const imageSizes =
    sizes ??
    (compact
      ? '(max-width: 640px) 34vw, (max-width: 1024px) 22vw, 17vw'
      : '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw');
  const tr = useTr();
  // Global reach: show the price converted to the viewer's detected/selected
  // currency (from CountryContext, populated via IP geolocation or manual
  // country selection) rather than always showing the seller's own currency.
  const { currency: viewerCurrency } = useCountry();
  // Admin-only quick edit: the pen icon below links straight into the
  // existing edit interface (/listings/create?edit=:id). The backend's
  // PUT /listings/:id route already allows role === 'ADMIN' regardless of
  // ownership, so this is purely a frontend entry point — no new
  // authorization surface is introduced.
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const displayCurrency = viewerCurrency;

  // Every usable image for this listing, best first: approved CDN images, then
  // the legacy `images[]` URLs. If one cannot be loaded we move on to the next
  // instead of immediately showing "No image available".
  const candidates: string[] = [];
  for (const raw of [
    ...(listing.productImages ?? []).map((image) => image.cdnUrl),
    ...(listing.images ?? []),
  ]) {
    const resolved = typeof raw === 'string' ? resolveImageUrl(raw) : '';
    if (resolved && !candidates.includes(resolved)) candidates.push(resolved);
  }
  const candidatesKey = candidates.join('|');

  // `idx` = which candidate is showing; `unoptimized` = bypass the /_next/image
  // optimizer for it (the optimizer fetches server-side and fails for hosts it
  // cannot reach, even when the browser can load the file directly).
  const [idx, setIdx] = useState(0);
  const [unoptimized, setUnoptimized] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset when the card is re-used for a different listing / image set.
  useEffect(() => {
    setIdx(0);
    setUnoptimized(false);
  }, [candidatesKey]);

  const imgSrc: string | null = candidates[idx] ?? null;
  const imgFailed = imgSrc === null;

  const handleImgError = useCallback(() => {
    if (!unoptimized) {
      // 1st failure: retry the same file directly, without the optimizer.
      setUnoptimized(true);
    } else {
      // Direct load failed too: try the next image, else fall to the placeholder.
      setUnoptimized(false);
      setIdx((i) => i + 1);
    }
  }, [unoptimized]);

  // An <img> that fails during SSR/before hydration never fires React's onError,
  // leaving a broken image. Re-check once mounted and whenever the source changes.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) handleImgError();
  }, [imgSrc, unoptimized, handleImgError]);

  // Overlay badges: Featured → Price dropped → New (first two only).
  const badges = getListingBadges(listing).slice(0, 2);

  return (
    <div className={`group bg-white rounded-lg xs:rounded-xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1 hover:border-red-100 flex h-full flex-col`}>
      {/* Image container — fixed 4:3 aspect ratio */}
      <div className="relative overflow-hidden bg-gray-50 rounded-t-lg xs:rounded-t-xl aspect-[4/3]">
        <Link href={`/listings/${listing.id}`} className="block absolute inset-0" tabIndex={-1}>
          {imgFailed || !imgSrc ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gray-100">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-[9px] text-gray-400 leading-tight text-center px-2">{tr('No image available')}</p>
            </div>
          ) : (
            <Image
              ref={imgRef}
              key={`${imgSrc}|${unoptimized ? 'direct' : 'opt'}`}
              src={imgSrc}
              unoptimized={unoptimized}
              alt={listing.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes={imageSizes}
              quality={92}
              onError={handleImgError}
              loading="lazy"
            />
          )}
        </Link>

        {/* Overlay gradient on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

        {/* Badges — country/flag removed from listing cards per product
            decision (launch scope is Uganda-only, so it was pure noise).
            KYC-verified and "New" moved down to the text area as small
            stamp-style badges (see below); this overlay now only carries
            the discount and general "Verified" badges. */}
        {!cleanImage && (
          <div className={`absolute top-1.5 xs:top-2 left-1.5 xs:left-2 flex flex-col gap-1 ${compact ? 'max-w-[calc(100%-2.25rem)] sm:max-w-none [&>span:nth-child(n+2)]:hidden sm:[&>span:nth-child(n+2)]:inline-flex' : ''}`}>
            {badges.map((b) => (
              <span key={b.kind} className={`inline-flex w-fit items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] xs:text-[10px] font-extrabold shadow-sm ${b.className}`}>
                <span aria-hidden="true">{b.icon}</span> {tr(b.label.replace(/ \d+%$/, ''))}{/\d+%$/.test(b.label) ? ` ${b.label.match(/\d+%$/)![0]}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* Verified seller — identity (KYC) verified, bottom-left so it never fights the top badges. */}
        {!cleanImage && listing.user?.isKycVerified && (
          <span className={`absolute bottom-1.5 left-1.5 items-center gap-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[9px] xs:text-[10px] font-bold text-emerald-700 shadow-sm ring-1 ring-emerald-100 ${compact ? 'hidden sm:inline-flex' : 'inline-flex'}`} title={tr('This seller has completed identity (KYC) verification')}>
            <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM13.707 7.707a1 1 0 00-1.414-1.414L9 9.586 7.707 8.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
            {tr('Verified seller')}
          </span>
        )}

        {/* SOLD overlay */}
        {listing.status === 'SOLD' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="bg-red-500 text-white text-[10px] xs:text-xs font-bold px-2.5 xs:px-3 py-0.5 xs:py-1 rounded-lg shadow tracking-wider uppercase">{tr('Sold')}</span>
          </div>
        )}

        {/* Favorite (heart) — regular-user affordance only; admins get the
            edit pen inline with the price instead (see below), so the
            heart never appears for them here.
            Always visible on touch (opacity-100) since group-hover never
            fires on mobile — a phone has no cursor to hover with, so a
            hover-only reveal made this completely untappable on the
            primary device this app is used on. Hover-to-reveal is kept
            only at sm: and up, where a mouse actually exists and the
            decluttered default state is a real benefit. */}
        {showFavorite && !isAdmin && !cleanImage && (
          <div className={`absolute top-1.5 right-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200 ${compact ? 'origin-top-right scale-75 sm:scale-100' : ''}`}>
            <FavoriteButton listingId={listing.id} />
          </div>
        )}
      </div>{/* end image container */}

      {/* Content */}
      {/* compact (carousel) cards share one text-area height with Featured and Today's Deals cards, so every card in every row is the same size */}
      <div className={`flex flex-1 flex-col ${compact ? 'p-1.5 xs:p-2 sm:p-3 min-h-[7.25rem] sm:min-h-[11rem] lg:min-h-[9.75rem]' : 'p-3 xs:p-3.5'}`}>
        {/* flex-1 + a minimum height: text block is the same height on every card, price is pinned to the bottom */}
        <Link href={`/listings/${listing.id}`} className="block flex-1 min-h-[3.25rem] sm:min-h-[4.75rem]">
          {/* "Stamp" badges — KYC-verified and New, moved down from the
              image overlay into the text area per product decision, styled
              like a rubber stamp (rotated, outlined, ink-on-paper) rather
              than the flat pill badges used on the image. */}
          {(listing.tier === 'GOLD' || listing.tier === 'PLATINUM' || listing.condition === 'NEW' || listing.motorDetails || listing.propertyDetails) && (
            <div className={`flex items-center gap-1 mb-1 flex-wrap ${compact ? '[&>span:nth-child(n+3)]:hidden sm:[&>span:nth-child(n+3)]:inline-flex' : ''}`}>
              {/* Tier badge — always first/leftmost so it's the first thing
                  a buyer's eye catches, matching "premium verified badge,
                  higher visibility" from the tier spec. Solid fill rather
                  than the outline treatment used below, so Gold/Platinum
                  reads as a step above the New/KYC/spec stamps. */}
              {listing.tier === 'PLATINUM' && (
                <span className="inline-flex items-center gap-0.5 text-[8px] xs:text-[9px] font-extrabold uppercase tracking-wider text-white bg-gradient-to-r from-slate-600 to-slate-800 rounded px-1.5 py-px select-none">
                  💎 Platinum
                </span>
              )}
              {listing.tier === 'GOLD' && (
                <span className="inline-flex items-center gap-0.5 text-[8px] xs:text-[9px] font-extrabold uppercase tracking-wider text-white bg-gradient-to-r from-amber-500 to-yellow-600 rounded px-1.5 py-px select-none">
                  🥇 Gold
                </span>
              )}              {listing.condition === 'NEW' && (
                <span className="inline-flex items-center gap-0.5 text-[8px] xs:text-[9px] font-extrabold uppercase tracking-wider text-emerald-600 border-[1.5px] border-emerald-500/80 rounded px-1 py-px -rotate-3 select-none">
                  <span aria-hidden="true">✦</span> New
                </span>
              )}
              {/* Motors/Property glance-worthy stats, same rubber-stamp
                  treatment as New/KYC above — a buyer scanning a grid of
                  cars or apartments shouldn't have to open every listing
                  just to see the year or bedroom count. Full specs (fuel
                  type, transmission, size, etc.) are on the listing detail
                  page; this is only the one or two facts worth a glance
                  from the card. */}
              {listing.motorDetails?.year && (
                <span className="inline-flex items-center gap-0.5 text-[8px] xs:text-[9px] font-extrabold uppercase tracking-wider text-blue-600 border-[1.5px] border-blue-500/80 rounded px-1 py-px -rotate-2 select-none">
                  {listing.motorDetails.year}
                </span>
              )}
              {listing.motorDetails?.mileage && (
                <span className="inline-flex items-center gap-0.5 text-[8px] xs:text-[9px] font-extrabold uppercase tracking-wider text-blue-600 border-[1.5px] border-blue-500/80 rounded px-1 py-px rotate-1 select-none">
                  {Number(listing.motorDetails.mileage).toLocaleString('en-US')} km
                </span>
              )}
              {listing.propertyDetails && (listing.propertyDetails.bedrooms || listing.propertyDetails.bathrooms) && (
                <span className="inline-flex items-center gap-0.5 text-[8px] xs:text-[9px] font-extrabold uppercase tracking-wider text-amber-600 border-[1.5px] border-amber-500/80 rounded px-1 py-px -rotate-1 select-none">
                  {listing.propertyDetails.bedrooms && `${listing.propertyDetails.bedrooms} Bed`}
                  {listing.propertyDetails.bedrooms && listing.propertyDetails.bathrooms && ' · '}
                  {listing.propertyDetails.bathrooms && `${listing.propertyDetails.bathrooms} Bath`}
                </span>
              )}
            </div>
          )}

          <h3 className={`font-bold text-gray-900 leading-tight hover:text-red-600 transition-colors truncate ${compact ? 'text-[11px] xs:text-xs sm:text-sm' : 'text-xs xs:text-sm'}`} title={listing.title}>
            {listing.title}
          </h3>
          {listing.description && (
            <p className={`text-[9px] xs:text-[10px] text-gray-400 leading-tight mt-1 truncate ${compact ? 'hidden sm:block' : ''}`}>
              {listing.description}
            </p>
          )}
          {listing.user?.store?.name && (
            <div className={`items-center gap-1 mt-1 ${compact ? 'hidden sm:flex' : 'flex'}`} title={listing.user.store.name}>
              <span className="relative w-3.5 h-3.5 rounded-full overflow-hidden bg-gray-100 shrink-0">
                {listing.user.store.logo ? (
                  <Image src={resolveImageUrl(listing.user.store.logo)} alt={listing.user.store.name} fill className="object-cover" sizes="14px" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-[7px]">🏬</span>
                )}
              </span>
              <span className="text-[8px] xs:text-[9px] text-gray-400 truncate">{listing.user.store.name}</span>
            </div>
          )}
        </Link>

        {/* Price row — the edit pen (admin only) sits inline at the end of
            this row; the regular-user quick-add now lives on the image
            itself (bottom-right corner, see above) rather than here, to
            match the reference mobile layout. */}
        <div className={`flex items-center justify-between gap-1.5 mt-auto ${compact ? 'pt-1 sm:pt-1.5' : 'pt-1.5'}`}>
          <Link href={`/listings/${listing.id}`} className="flex items-baseline gap-1.5 flex-wrap min-w-0">
            <CurrencyDisplay
              amount={listing.price}
              currency={listing.currency}
              displayCurrency={displayCurrency}
              unit={listing.priceUnit}
              className={`text-red-600 font-extrabold leading-none ${compact ? 'text-xs xs:text-[13px] sm:text-base' : 'text-sm xs:text-base'}`}
            />
            {listing.originalPrice != null && listing.originalPrice > listing.price && (
              <CurrencyDisplay
                amount={listing.originalPrice}
                currency={listing.currency}
                displayCurrency={displayCurrency}
                className={`text-gray-400 line-through leading-none ${compact ? 'text-[9px] xs:text-[10px] sm:text-xs' : 'text-[10px] xs:text-xs'}`}
              />
            )}
          </Link>
          {isAdmin && <AdminEditInlineButton listingId={listing.id} size="sm" />}
        </div>
        {displayCurrency !== listing.currency && (
          <Link href={`/listings/${listing.id}`} className={`text-[9px] xs:text-[10px] text-gray-400 mt-0.5 leading-none ${compact ? 'hidden sm:block' : 'block'}`}>
            Listed at {listing.currency} {listing.price.toLocaleString()}
            {listing.priceUnit === 'KG' && ' / kg'}
            {listing.priceUnit === 'TONNE' && ' / tonne'}
          </Link>
        )}
      </div>

    </div>
  );
}

