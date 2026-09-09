'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Currency, Listing } from '@/lib/types';
import { resolveImageUrl, getCurrency, convertCurrency, formatCurrency } from '@/lib/utils';
import { useCountry } from '@/context/CountryContext';
import { useAuth } from '@/context/AuthContext';
import { QuickAddButton } from '@/components/listings/QuickAddButton';
import { MobileCardCarousel } from '@/components/ui/MobileCardCarousel';
import { useIntlayer } from 'next-intlayer';

interface FlashMediaItem {
  id: string;
  cdnUrl: string;
  title?: string | null;
  shortDescription?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  currency?: Currency | null;
  altText?: string | null;
  linkUrl?: string | null;
}

interface Props {
  listings: Listing[];
  media?: FlashMediaItem[];
}

interface CardData {
  id: string;
  href: string | null;
  title: string;
  shortDescription?: string | null;
  imageUrl: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: Currency | null;
  listing?: Listing;
}

const truncateTitle = (value: string, max = 26) => (
  value.length <= max ? value : `${value.slice(0, max - 3).trimEnd()}...`
);

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Returns a pseudo-random integer [min, max] seeded from a string. */
const seededInt = (seed: string, min: number, max: number) => {
  const hash = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return min + (hash % (max - min + 1));
};

function useCountdown(listings: Listing[]) {
  const expiryTime = useMemo(() => {
    const now = Date.now();
    const listingExpiryTimes = listings
      .map((listing) => (listing.placementExpiresAt ? new Date(listing.placementExpiresAt).getTime() : NaN))
      .filter((value) => Number.isFinite(value) && value > now) as number[];

    if (listingExpiryTimes.length > 0) {
      return Math.min(...listingExpiryTimes);
    }

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay.getTime();
  }, [listings]);

  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const calc = () => {
      const diff = Math.max(0, expiryTime - Date.now());
      setTimeLeft({
        hours: Math.floor(diff / 3_600_000),
        minutes: Math.floor((diff % 3_600_000) / 60_000),
        seconds: Math.floor((diff % 60_000) / 1_000),
      });
    };

    calc();
    const interval = window.setInterval(calc, 1000);
    return () => window.clearInterval(interval);
  }, [expiryTime]);

  return timeLeft;
}

function useItemsLeft(seed: string): [number, number] {
  const maxItems = useMemo(() => seededInt(seed, 8, 60), [seed]);
  const [count, setCount] = useState<number>(maxItems);
  const resetCountRef = useRef(0);

  useEffect(() => {
    const delay = seededInt(seed + '_delay', 3000, 7000);
    const timer = setInterval(() => {
      setCount((prev) => {
        if (prev <= 1) {
          resetCountRef.current += 1;
          return seededInt(seed + '_reset_' + resetCountRef.current, 8, 60);
        }
        return prev - 1;
      });
    }, delay);
    return () => clearInterval(timer);
  }, [seed]);

  return [count, maxItems];
}

/** Single flash sale card with its own live items-left counter. */
function FlashCard({ card, displayCurrency }: { card: CardData; displayCurrency: Currency }) {
  const t = useIntlayer('flash-deals');
  const [itemsLeft, maxItems] = useItemsLeft(card.id);
  const pct = Math.round((itemsLeft / maxItems) * 100);
  const isLow = itemsLeft <= 5;
  // Tracks whether the resolved image actually failed to load (e.g. the
  // backend's local-disk upload fallback got wiped by a redeploy and now
  // 404s). Falls back to the "Coming soon" placeholder instead of leaving
  // a broken image + a failed network request nagging the console.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!card.imageUrl && !imgFailed;

  // Buyer quick-add — same gating as ListingCard/FeaturedProductCard: only
  // for signed-in non-admin buyers who aren't the listing's own seller,
  // and only for real listing-backed cards (media-only placeholder cards
  // have no listing to add to a cart).
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isOwnListing = !!card.listing && !!user && user.id === card.listing.userId;
  const showQuickAdd = !!card.listing && !!user && !isAdmin && !isOwnListing;

  // Convert price to display currency if needed
  const displayPrice = card.price !== null && card.currency
    ? convertCurrency(card.price, card.currency, displayCurrency)
    : null;
  const displayOriginal = card.originalPrice !== null && card.currency
    ? convertCurrency(card.originalPrice, card.currency, displayCurrency)
    : null;
  const discountPercent =
    displayOriginal != null && displayPrice != null && displayOriginal > displayPrice && displayOriginal > 0
      ? Math.round(((displayOriginal - displayPrice) / displayOriginal) * 100)
      : null;

  // Card shell/sizing below mirrors ListingCard (used in "Other Collections")
  // so Flash Deal cards sit at the same footprint as the rest of the site:
  // rounded-lg/xl shell, 4:3 image, p-3/3.5 content padding, xs/sm text scale.
  const inner = (
    <>
      <div className="relative overflow-hidden bg-gradient-to-br from-orange-50 to-amber-50 rounded-t-lg xs:rounded-t-xl aspect-[4/3]">
        {showImage ? (
          <Image
            src={card.imageUrl as string}
            alt={card.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 31vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
            quality={92}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <span className="text-3xl opacity-30">⚡</span>
            <span className="text-[9px] xs:text-[10px] text-amber-600 font-semibold">{t.comingSoon}</span>
          </div>
        )}
        {/* Overlay gradient on hover, matching ListingCard */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
        {/* Hot deal badge — top-left, small pill */}
        <div className="absolute top-1.5 xs:top-2 left-1.5 xs:left-2">
          <span
            className="inline-flex items-center gap-0.5 rounded-md bg-orange-500 text-white text-[9px] xs:text-[10px] font-extrabold uppercase px-1.5 py-0.5 shadow-sm w-fit"
            aria-label="Hot deal"
          >
            <span aria-hidden="true">🔥</span> {t.hotBadge}
          </span>
        </div>
        {/* Offer stripe — diagonal ribbon banner across the top corner,
            the "strip on the price" savings callout, clipped to the image
            so it never spills past the card's rounded edges. */}
        {discountPercent != null && discountPercent > 0 && (
          <div className="absolute top-0 right-0 w-20 h-20 overflow-hidden pointer-events-none" aria-hidden="true">
            <div className="absolute top-[14px] right-[-30px] w-[120px] rotate-45 bg-gradient-to-r from-red-600 to-orange-500 text-white text-[9px] xs:text-[10px] font-black text-center py-0.5 shadow-md tracking-wide">
              -{discountPercent}%
            </div>
          </div>
        )}
        {/* Buyer quick-add — bottom-right (matches the reference mobile
            grocery-app layout), stops propagation so it doesn't
            trigger the card's own Link navigation. */}
        {showQuickAdd && (
          <div className="absolute bottom-1.5 xs:bottom-2 right-1.5 xs:right-2">
            <QuickAddButton listing={card.listing as Listing} size="sm" />
          </div>
        )}
      </div>

      <div className="p-3 xs:p-3.5">
        <p className="font-bold text-gray-900 text-xs xs:text-sm leading-tight line-clamp-2 min-h-[2.2em]" title={card.title}>
          {card.title}
        </p>
        {card.shortDescription && (
          <p className="text-[9px] xs:text-[10px] text-gray-400 leading-tight mt-1 truncate">
            {card.shortDescription}
          </p>
        )}
        {/* Price row — the discount reads as a small colour "stripe" chip
            sitting right beside the price, echoing the ribbon on the image
            above, rather than a plain strikethrough alone. */}
        {displayPrice !== null && (
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            <span className="text-red-600 font-extrabold text-sm xs:text-base tabular-nums leading-none">
              {formatCurrency(displayPrice, displayCurrency)}
            </span>
            {displayOriginal !== null && displayOriginal > 0 && displayPrice > 0 && displayOriginal > displayPrice && (
              <span className="text-gray-400 line-through text-[10px] xs:text-xs tabular-nums leading-none">
                {formatCurrency(displayOriginal, displayCurrency)}
              </span>
            )}
            {discountPercent != null && discountPercent > 0 && (
              <span className="inline-flex items-center rounded bg-gradient-to-r from-red-600 to-orange-500 text-white text-[8px] xs:text-[9px] font-black px-1 py-px leading-tight shadow-sm">
                -{discountPercent}%
              </span>
            )}
            {/* Show original currency if converted */}
            {card.currency && card.currency !== displayCurrency && card.price !== null && (
              <span className="text-[9px] xs:text-[10px] text-gray-400 tabular-nums leading-none w-full">
                ({formatCurrency(card.price, card.currency)})
              </span>
            )}
          </div>
        )}
        {/* Stock indicator — decorated with an icon, live count, and a
            continuously animated light-sweep on the bar itself so it reads
            as a moving, "live" signal rather than a static gauge. */}
        <div className="flex items-center justify-between mt-2">
          <span className="inline-flex items-center gap-1 text-[9px] xs:text-[10px] text-gray-400 font-semibold uppercase tracking-wide">
            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M11.983 1.907a.75.75 0 00-1.292-.657L4.5 9.75a.75.75 0 00.615 1.183h3.196l-1.8 6.907a.75.75 0 001.292.657l6.191-8.5a.75.75 0 00-.615-1.183h-3.196l1.8-6.907z" /></svg>
            In stock
          </span>
          <span className={`text-[9px] xs:text-[10px] font-extrabold tabular-nums ${isLow ? 'text-red-500 animate-pulse' : 'text-emerald-600'}`}>
            {itemsLeft} left
          </span>
        </div>
        <div className="relative h-1.5 mt-1 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: isLow
                ? 'linear-gradient(90deg,#ef4444,#f97316)'
                : 'linear-gradient(90deg,#10b981,#84cc16,#eab308)',
            }}
          />
          {/* Moving highlight sweep — purely decorative, clipped to the bar */}
          <div
            className="absolute inset-y-0 left-0 w-1/3 animate-stock-shine pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)' }}
            aria-hidden="true"
          />
        </div>
      </div>
    </>
  );

  const cardShellClass = 'group bg-white rounded-lg xs:rounded-xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1 hover:border-red-100';

  if (card.listing) {
    return (
      <Link href={`/listings/${card.listing.id}`} className={cardShellClass}>
        {inner}
      </Link>
    );
  }

  if (card.href) {
    return <Link href={card.href} className={cardShellClass}>{inner}</Link>;
  }
  return <div className={cardShellClass}>{inner}</div>;
}

export default function FlashDeals({ listings, media = [] }: Props) {
  const t = useIntlayer('flash-deals');
  const { hours, minutes, seconds } = useCountdown(listings);
  const { country } = useCountry();
  const displayCurrency = getCurrency(country);

  const cards: CardData[] = listings.length > 0
    ? listings.slice(0, 6).map((listing) => {
        // Use productImages first (CDN), then fall back to images array
        const productImgUrl = (listing.productImages as Array<{ cdnUrl: string }> | undefined)?.find(p => p.cdnUrl)?.cdnUrl;
        const rawImageUrl = productImgUrl || listing.images?.[0] || null;
        return {
          id: listing.id,
          href: `/listings/${listing.id}`,
          title: truncateTitle(listing.title, 30),
          shortDescription: listing.description || null,
          imageUrl: rawImageUrl ? (resolveImageUrl(rawImageUrl) || null) : null,
          price: listing.price,
          originalPrice: listing.originalPrice ?? null,
          currency: listing.currency,
          listing,
        };
      })
    : media.slice(0, 6).map((item, index) => ({
        id: item.id,
        href: item.linkUrl || '/flash-sales',
        title: truncateTitle(item.title || item.altText || `Flash Deal Item ${index + 1}`, 30),
        shortDescription: item.shortDescription || null,
        imageUrl: resolveImageUrl(item.cdnUrl) || null,
        price: toNumberOrNull(item.price),
        originalPrice: toNumberOrNull(item.originalPrice),
        currency: item.currency ?? null,
      }));

  if (cards.length === 0) {
    return (
      <section className="overflow-hidden rounded-2xl shadow-md border border-orange-100 bg-gradient-to-br from-orange-50 via-amber-50/70 to-white animate-fade-up">
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between border-b border-orange-100/80 bg-gradient-to-r from-orange-500 to-amber-500 text-white">
          <div className="flex items-center gap-2">
            <span className="text-2xl drop-shadow-lg animate-bounce" aria-hidden="true">🔥</span>
            <div>
              <h2 className="text-base font-extrabold leading-tight tracking-wide uppercase">{t.heading}</h2>
              <p className="text-[11px] text-white/90">{t.tagline}</p>
              <p className="text-[10px] text-white/80 mt-0.5">{t.description}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 p-3 sm:p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg xs:rounded-xl border border-orange-100 overflow-hidden animate-pulse bg-white">
              <div className="aspect-[4/3] bg-orange-50" />
              <div className="p-3 xs:p-3.5 space-y-1.5">
                <div className="h-2.5 bg-orange-100 rounded w-3/4" />
                <div className="h-2 bg-orange-50 rounded w-1/2" />
                <div className="h-3 bg-orange-100 rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl shadow-md border border-orange-100 bg-gradient-to-br from-orange-50 via-amber-50/70 to-white animate-fade-up">
      {/* Header — the section's only saturated colour is here, in a
          contained bar, rather than washing the whole card grid in a dark
          gradient; the body below stays light so it sits comfortably next
          to "Other Collections" and the rest of the homepage. */}
      <div className="relative flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between overflow-hidden bg-gradient-to-r from-orange-500 to-amber-500 text-white">
        {/* Decorative blobs */}
        <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/10 blur-xl pointer-events-none" />
        <div className="absolute -bottom-6 left-10 w-32 h-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative flex items-center gap-2.5">
          <span className="text-2xl drop-shadow-lg animate-bounce" aria-hidden="true">🔥</span>
          <div>
            <h2 className="text-base font-extrabold leading-tight tracking-wide uppercase">{t.heading}</h2>
            <p className="text-[11px] text-white/90">{t.tagline}</p>
            <p className="text-[10px] text-white/80 mt-0.5">{t.description}</p>
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Link
            href="/flash-sales"
            aria-label="View all flash deals"
            className="text-xs font-semibold text-white/90 hover:text-white border border-white/30 hover:border-white/60 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-all flex items-center gap-1 shrink-0"
          >
            <span className="sm:hidden">{t.viewAllShort}</span>
            <span className="hidden sm:inline">{t.viewAllLong}</span>
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <div
            className="flex items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-3 py-1.5 text-xs font-bold backdrop-blur-sm tabular-nums shadow-inner shrink-0"
            aria-label={`Time left: ${String(hours).padStart(2, '0')} hours, ${String(minutes).padStart(2, '0')} minutes, ${String(seconds).padStart(2, '0')} seconds`}
            aria-live="polite"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-ping absolute opacity-60" aria-hidden="true" />
            <span className="w-2 h-2 rounded-full bg-white relative" aria-hidden="true" />
            <span aria-hidden="true">
              {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
          </div>
        </div>
      </div>

      {/* Cards — mobile carousel (3/row, swipe + arrows), grid at sm+.
          Same breakpoint/gap and card sizing as "Other Collections" below,
          just wrapped in the horizontal-scroll carousel on mobile. Light
          background so the white cards read clearly against it. */}
      <div className="bg-orange-50/40 p-3 sm:p-4">
        <MobileCardCarousel gridClassName="sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" ariaLabel="Flash Deals listings">
          {cards.map((card) => (
            <FlashCard key={card.id} card={card} displayCurrency={displayCurrency} />
          ))}
        </MobileCardCarousel>
      </div>
    </section>
  );
}


