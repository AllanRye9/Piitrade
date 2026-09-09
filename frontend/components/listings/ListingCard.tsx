'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Listing } from '@/lib/types';
import { CurrencyDisplay } from '@/components/ui/CurrencyDisplay';
import { resolveImageUrl } from '@/lib/utils';
import { FavoriteButton } from './FavoriteButton';
import { QuickAddButton } from './QuickAddButton';
import { AdminEditInlineButton } from './AdminEditInlineButton';
import { useCountry } from '@/context/CountryContext';
import { useAuth } from '@/context/AuthContext';

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
}

export function ListingCard({
  listing,
  showFavorite = true,
  cleanImage = false,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
}: Props) {
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
  // Regular-user quick add-to-cart: shown to any signed-in non-admin buyer
  // who isn't the listing's own seller (a seller shouldn't be able to add
  // their own listing to their cart). QuickAddButton itself handles the
  // in-cart / unavailable states.
  const isOwnListing = !!user && user.id === listing.userId;
  const showQuickAdd = !!user && !isAdmin && !isOwnListing;
  const displayCurrency = viewerCurrency;

  const primaryImage =
    listing.productImages?.find((image) => image.cdnUrl)?.cdnUrl ??
    listing.images?.[0] ??
    null;
  const [imgSrc, setImgSrc] = useState(resolveImageUrl(primaryImage) || null);
  const [imgFailed, setImgFailed] = useState(!resolveImageUrl(primaryImage));

  const handleImgError = () => {
    if (!imgFailed) {
      setImgFailed(true);
      setImgSrc(null);
    }
  };

  // "Save X%" badge — reference mobile layout puts this front-and-centre on
  // every discounted card; the strikethrough price alone doesn't carry the
  // same at-a-glance signal. Only shown when there's a real discount to
  // report (originalPrice strictly greater than the current price).
  const discountPercent =
    listing.originalPrice != null && listing.originalPrice > listing.price && listing.originalPrice > 0
      ? Math.round(((listing.originalPrice - listing.price) / listing.originalPrice) * 100)
      : null;

  return (
    <div className="group bg-white rounded-lg xs:rounded-xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1 hover:border-red-100">
      {/* Image container — fixed 4:3 aspect ratio */}
      <div className="relative overflow-hidden bg-gray-50 rounded-t-lg xs:rounded-t-xl aspect-[4/3]">
        <Link href={`/listings/${listing.id}`} className="block absolute inset-0" tabIndex={-1}>
          {imgFailed || !imgSrc ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gray-100">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-[9px] text-gray-400 leading-tight text-center px-2">No image available</p>
            </div>
          ) : (
            <Image
              src={imgSrc}
              alt={listing.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes={sizes}
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
          <div className="absolute top-1.5 xs:top-2 left-1.5 xs:left-2 flex flex-col gap-1">
            {discountPercent != null && discountPercent > 0 && (
              <span className="inline-flex items-center rounded-md bg-lime-400 text-emerald-950 text-[9px] xs:text-[10px] font-extrabold px-1.5 py-0.5 shadow-sm w-fit">
                Save {discountPercent}%
              </span>
            )}
            {listing.user?.isVerified && (
              <span className="badge text-[9px] xs:text-[10px] shadow-sm bg-red-500 text-white">
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified
              </span>
            )}
          </div>
        )}

        {/* SOLD overlay */}
        {listing.status === 'SOLD' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="bg-red-500 text-white text-[10px] xs:text-xs font-bold px-2.5 xs:px-3 py-0.5 xs:py-1 rounded-lg shadow tracking-wider uppercase">Sold</span>
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
          <div className="absolute top-1.5 right-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
            <FavoriteButton listingId={listing.id} />
          </div>
        )}

        {/* Buyer quick-add — bottom-right corner of the image, matching the
            reference mobile grocery-app layout (Talabat-style): a floating
            circle on the photo itself rather than a control competing for
            space in the text/price area below. QuickAddButton stops
            propagation on click so it doesn't trigger the card's Link. */}
        {showQuickAdd && !cleanImage && (
          <div className="absolute bottom-1.5 xs:bottom-2 right-1.5 xs:right-2">
            <QuickAddButton listing={listing} size="sm" />
          </div>
        )}
      </div>{/* end image container */}

      {/* Content */}
      <div className="p-3 xs:p-3.5">
        <Link href={`/listings/${listing.id}`} className="block">
          {/* "Stamp" badges — KYC-verified and New, moved down from the
              image overlay into the text area per product decision, styled
              like a rubber stamp (rotated, outlined, ink-on-paper) rather
              than the flat pill badges used on the image. */}
          {(listing.condition === 'NEW' || listing.user?.isKycVerified) && (
            <div className="flex items-center gap-1 mb-1 flex-wrap">
              {listing.condition === 'NEW' && (
                <span className="inline-flex items-center gap-0.5 text-[8px] xs:text-[9px] font-extrabold uppercase tracking-wider text-emerald-600 border-[1.5px] border-emerald-500/80 rounded px-1 py-px -rotate-3 select-none">
                  <span aria-hidden="true">✦</span> New
                </span>
              )}
              {listing.user?.isKycVerified && (
                <span
                  title="This seller has completed identity (KYC) verification"
                  className="inline-flex items-center gap-0.5 text-[8px] xs:text-[9px] font-extrabold uppercase tracking-wider text-red-600 border-[1.5px] border-red-500/80 rounded px-1 py-px rotate-2 select-none"
                >
                  <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                  KYC
                </span>
              )}
            </div>
          )}

          <h3 className="font-bold text-gray-900 text-xs xs:text-sm leading-tight hover:text-red-600 transition-colors truncate" title={listing.title}>
            {listing.title}
          </h3>
          {listing.description && (
            <p className="text-[9px] xs:text-[10px] text-gray-400 leading-tight mt-1 truncate">
              {listing.description}
            </p>
          )}
          {listing.user?.store?.name && (
            <div className="flex items-center gap-1 mt-1" title={listing.user.store.name}>
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
        <div className="flex items-center justify-between gap-1.5 mt-1.5">
          <Link href={`/listings/${listing.id}`} className="flex items-baseline gap-1.5 flex-wrap min-w-0">
            <CurrencyDisplay
              amount={listing.price}
              currency={listing.currency}
              displayCurrency={displayCurrency}
              className="text-red-600 font-extrabold text-sm xs:text-base leading-none"
            />
            {listing.originalPrice != null && listing.originalPrice > listing.price && (
              <CurrencyDisplay
                amount={listing.originalPrice}
                currency={listing.currency}
                displayCurrency={displayCurrency}
                className="text-gray-400 line-through text-[10px] xs:text-xs leading-none"
              />
            )}
          </Link>
          {isAdmin && <AdminEditInlineButton listingId={listing.id} size="sm" />}
        </div>
        {displayCurrency !== listing.currency && (
          <Link href={`/listings/${listing.id}`} className="block text-[9px] xs:text-[10px] text-gray-400 mt-0.5 leading-none">
            Listed at {listing.currency} {listing.price.toLocaleString()}
          </Link>
        )}
      </div>

    </div>
  );
}

