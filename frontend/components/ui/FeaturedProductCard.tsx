'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { resolveImageUrl, isDirectContactCategory } from '@/lib/utils';
import { Listing } from '@/lib/types';

interface FeaturedProductCardProps {
  storeName?: string;
  title?: string;
  description?: string;
  originalPrice?: string;
  discountedPrice?: string;
  /** Percentage off, pre-computed by the caller from whatever prices are
   *  actually being displayed (post currency-conversion) — kept separate
   *  from originalPrice/discountedPrice since those are pre-formatted
   *  display strings, not numbers this component could compute from. */
  discountPercent?: number;
  /** Optional note shown under the price, e.g. "Listed at AED 100" when the
   *  displayed price has been currency-converted from what the seller posted. */
  listedPriceNote?: string;
  imageUrl?: string;
  href?: string;
  isHandpicked?: boolean;
  className?: string;
  listing?: Listing;
  /** Smaller type/padding on phones for the one-row carousel (sm+ unchanged). */
  compact?: boolean;
}

export default function FeaturedProductCard({
  storeName,
  title = 'Featured Item',
  description,
  originalPrice,
  discountedPrice,
  discountPercent,
  listedPriceNote,
  imageUrl,
  href,
  isHandpicked = false,
  className = '',
  listing,
  compact = false,
}: FeaturedProductCardProps & { className?: string }) {
  // When a listing is provided its URL always takes precedence over an explicit href.
  const resolvedHref = listing ? `/listings/${listing.id}` : href;

  const navigable = !!resolvedHref;


  // Tracks whether the resolved image actually failed to load at runtime
  // (e.g. it was uploaded to the backend's local-disk fallback and then
  // wiped by a redeploy, leaving a dead URL). Falls back to the same
  // "No image available" placeholder used when there's no imageUrl at all,
  // instead of showing a broken image / spamming the console with 404s.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!imageUrl && !imgFailed;

  const cardBody = (
    <div className={`bg-white rounded-lg xs:rounded-xl border border-gray-100 overflow-hidden transition-all duration-300 shine-card${navigable ? ' hover:shadow-card-hover hover:-translate-y-1 hover:border-red-100' : ''}`}>
      {/* Image — no text overlaid */}
      <div className="aspect-[4/3] relative overflow-hidden bg-gray-50 rounded-t-lg xs:rounded-t-xl">
        {showImage ? (
          <Image
            src={resolveImageUrl(imageUrl as string)}
            alt={title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            quality={92}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gray-100">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-[9px] text-gray-400 text-center px-2">No image available</p>
          </div>
        )}
        {/* Subtle hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
        {discountPercent != null && discountPercent > 0 && (
          <div className="absolute top-1.5 xs:top-2 left-1.5 xs:left-2">
            <span className="inline-flex items-center rounded-md bg-lime-400 text-emerald-950 text-[9px] xs:text-[10px] font-extrabold px-1.5 py-0.5 shadow-sm">
              Save {discountPercent}%
            </span>
          </div>
        )}
        {/* Handpicked badge — bottom corner, small and subtle */}
        {isHandpicked && (
          <div className="absolute bottom-1.5 right-1.5">
            <span className="bg-white/90 text-red-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm shadow-sm flex items-center gap-0.5">
              <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
              Pick
            </span>
          </div>
        )}
      </div>

      {/* Text content — all BELOW the image, same padding/text scale as
          ListingCard ("Other Collections" standard) for a consistent
          card footprint across every listing section on the site. */}
      <div className={compact ? 'p-1.5 xs:p-2 sm:p-3' : 'p-3 xs:p-3.5'}>
        {storeName && (
          <p className="text-[9px] xs:text-[10px] text-gray-400 font-medium mb-0.5 truncate">{storeName}</p>
        )}
        <h3 className={`font-bold text-gray-900 leading-tight truncate ${compact ? 'text-[11px] xs:text-xs sm:text-sm' : 'text-xs xs:text-sm'}`} title={title}>{title}</h3>
        {description && (
          <p className={`text-[9px] xs:text-[10px] text-gray-400 leading-tight mt-1 truncate ${compact ? 'hidden sm:block' : ''}`}>{description}</p>
        )}
        {(originalPrice || discountedPrice) && (
          <div className="flex items-baseline gap-1.5 flex-wrap mt-1.5">
            {discountedPrice && (
              <span className={`text-red-600 font-extrabold tabular-nums leading-none ${compact ? 'text-xs xs:text-[13px] sm:text-base' : 'text-sm xs:text-base'}`}>{discountedPrice}</span>
            )}
            {originalPrice && (
              <span className={`text-gray-400 line-through tabular-nums leading-none ${compact ? 'text-[9px] xs:text-[10px] sm:text-xs' : 'text-[10px] xs:text-xs'}`}>{originalPrice}</span>
            )}
          </div>
        )}
        {listedPriceNote && (
          <p className="text-[9px] xs:text-[10px] text-gray-400 mt-0.5 leading-none">{listedPriceNote}</p>
        )}
      </div>
    </div>
  );

  if (resolvedHref) {
    return <Link href={resolvedHref} className={`block group ${className}`}>{cardBody}</Link>;
  }
  return <div className={className}>{cardBody}</div>;
}
