'use client';

import { useState, useEffect, use } from 'react';
import { API_URL } from '@/lib/api';
import Image from 'next/image';
import Link from 'next/link';
import { resolveImageUrl, getCurrency, formatCurrency, convertCurrency } from '@/lib/utils';
import { useCountry } from '@/context/CountryContext';
import type { Currency } from '@/lib/types';
import { StoreSocialLinks, SocialLinksData } from '@/components/ui/StoreSocialLinks';


const COUNTRY_FLAGS: Record<string, string> = {
  UAE: '🇦🇪', UGANDA: '🇺🇬', KENYA: '🇰🇪', CHINA: '🇨🇳',
};

interface StoreListing {
  id: string;
  title: string;
  price: number | null;
  currency: Currency;
  images: string[];
  productImages?: { cdnUrl: string }[];
  country: string;
  location: string;
  createdAt: string;
  status: string;
  category: { id: string; name: string; slug: string };
}

interface StoreData {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  logo: string | null;
  banner: string | null;
  rating: number;
  ratingCount: number;
  isActive: boolean;
  backgroundTheme?: { presetId?: string; primaryColor?: string; backgroundImage?: string | null } | null;
  user: {
    id: string;
    name: string;
    avatar: string | null;
    country: string;
    createdAt: string;
    companyName: string | null;
    businessDescription: string | null;
    website: string | null;
    socialLinks: SocialLinksData | null;
    listings: StoreListing[];
  };
}

function ListingPriceBadge({ listing, displayCurrency }: { listing: StoreListing; displayCurrency: Currency }) {
  if (listing.price === null) return <p className="text-sm font-bold text-gray-500">Contact seller</p>;
  const converted = convertCurrency(listing.price, listing.currency, displayCurrency);
  const showOriginal = displayCurrency !== listing.currency;
  return (
    <div>
      <p className="text-sm font-bold text-red-600">{formatCurrency(converted, displayCurrency)}</p>
      {showOriginal && (
        <p className="text-[10px] text-gray-400">{formatCurrency(listing.price, listing.currency)}</p>
      )}
    </div>
  );
}

export default function StoreSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { country: selectedCountry } = useCountry();
  const displayCurrency = getCurrency(selectedCountry);

  const [store, setStore] = useState<StoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('All');

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/api/stores/${slug}`)
      .then((r) => { if (!r.ok) { setNotFound(true); return null; } return r.json(); })
      .then((data) => { if (data) setStore(data.store || null); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !store) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-gray-500">
        <div className="text-6xl">🏪</div>
        <p className="text-xl font-bold text-gray-800">Web Store not found</p>
        <p className="text-sm">This Web Store may have been closed or the link is incorrect.</p>
        <Link href="/stores" className="mt-2 px-6 py-2.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-colors">
          Browse All Stores
        </Link>
      </div>
    );
  }

  const listings = (store.user.listings || []).filter((l) => l.status === 'ACTIVE');
  const displayName = store.user.companyName || store.name || store.user.name;
  const logoUrl = store.logo ? resolveImageUrl(store.logo) : null;
  const bannerUrl = store.banner ? resolveImageUrl(store.banner) : null;
  const countryFlag = COUNTRY_FLAGS[store.user.country] || '🌍';

  // Collect unique categories for filter tabs
  const categories = ['All', ...Array.from(new Set(listings.map((l) => l.category?.name).filter(Boolean)))];

  const filteredListings = categoryFilter === 'All'
    ? listings
    : listings.filter((l) => l.category?.name === categoryFilter);

  return (
    <div className="min-h-screen bg-gray-50/90">

      {/* Banner — compact so listings start sooner. Falls back to the
          site's default gradient when the store hasn't set a Background
          Theme (Store Dashboard → Edit Profile → Background Theme); a
          banner image, if set, still takes visual priority over either. */}
      <div
        className="relative h-20 sm:h-28 overflow-hidden bg-gradient-to-br from-red-500 via-rose-600 to-purple-700"
        style={store.backgroundTheme?.primaryColor ? { background: `linear-gradient(to bottom right, ${store.backgroundTheme.primaryColor}, ${store.backgroundTheme.primaryColor}dd)` } : undefined}
      >
        {bannerUrl && (
          <Image src={bannerUrl} alt={displayName} fill className="object-cover" priority sizes="100vw" />
        )}
        <div className="absolute inset-0 bg-black/30" />
        {/* Back link */}
        <Link
          href="/stores"
          className="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 flex items-center gap-1.5 bg-white/90 backdrop-blur-sm text-gray-800 text-[11px] sm:text-xs font-semibold px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full shadow hover:bg-white transition-colors"
        >
          ← All Stores
        </Link>
        {/* Country badge */}
        <span className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3 bg-white/90 backdrop-blur-sm text-gray-700 text-[11px] sm:text-xs font-bold px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full shadow">
          {countryFlag} {store.user.country}
        </span>
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-10">

        {/* Store header card — compact single row: logo, name, stats, actions */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3.5 sm:p-4 -mt-6 sm:-mt-8 relative z-10 mb-4">
          <div className="flex items-start gap-3">
            {/* Logo — uses `fill` + `sizes` for correct, non-distorted contain-fit at any logo aspect ratio */}
            <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden border-2 border-white shadow-md shrink-0 bg-gray-50 flex items-center justify-center">
              {logoUrl ? (
                <Image src={logoUrl} alt={displayName} fill className="object-contain p-1" sizes="64px" />
              ) : (
                <span className="text-2xl sm:text-3xl">🏪</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl font-extrabold text-gray-900 leading-tight truncate">{displayName}</h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
                    {store.ratingCount > 0 && (
                      <span className="flex items-center gap-1 text-amber-500 font-semibold">
                        ⭐ {store.rating.toFixed(1)}
                        <span className="text-gray-400 font-normal">({store.ratingCount})</span>
                      </span>
                    )}
                    <span>📦 {listings.length} active</span>
                    {store.user.website && (
                      <a
                        href={store.user.website.startsWith('http') ? store.user.website : `https://${store.user.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-red-500 hover:text-red-600 flex items-center gap-1 truncate"
                      >
                        🌐 {store.user.website.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                  </div>
                </div>
                {/* Social/contact buttons — only platforms this seller has set
                    appear (e.g. a WhatsApp number, group, or community link). */}
                <StoreSocialLinks links={store.user.socialLinks} size="sm" className="shrink-0" />
              </div>
              {(store.description || store.user.businessDescription) && (
                <p className="text-xs sm:text-sm text-gray-500 mt-1.5 line-clamp-1">
                  {store.description || store.user.businessDescription}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Price currency notice */}
        {listings.length > 0 && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-3.5 py-2 mb-3.5 text-[11px] sm:text-xs text-red-700 font-medium flex items-center gap-2">
            💱 Prices shown in <strong>{displayCurrency}</strong>
            {displayCurrency !== listings[0]?.currency && (
              <span className="text-red-500">(converted from listing currency)</span>
            )}
          </div>
        )}

        {/* Category filter tabs */}
        {categories.length > 2 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  categoryFilter === cat
                    ? 'bg-red-500 text-white shadow'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        <h2 className="text-lg font-extrabold text-gray-900 mb-4">
          {filteredListings.length} Listing{filteredListings.length !== 1 ? 's' : ''}
          {categoryFilter !== 'All' ? ` in ${categoryFilter}` : ''} from {displayName}
        </h2>

        {filteredListings.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400">
            <p className="text-4xl mb-3">📦</p>
            <p className="font-semibold text-gray-600">No active listings{categoryFilter !== 'All' ? ` in ${categoryFilter}` : ''}</p>
            {categoryFilter !== 'All' && (
              <button
                onClick={() => setCategoryFilter('All')}
                className="mt-3 text-sm text-red-600 font-semibold underline"
              >
                Show all listings
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {filteredListings.map((listing) => {
              const imgSrc =
                listing.productImages?.find((p) => p.cdnUrl)?.cdnUrl ||
                listing.images?.[0] || null;
              const resolvedImg = imgSrc ? resolveImageUrl(imgSrc) : null;

              return (
                <Link
                  key={listing.id}
                  href={`/listings/${listing.id}`}
                  className="group bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden flex flex-col"
                >
                  {/* Image */}
                  <div className="relative aspect-square bg-gray-100 overflow-hidden">
                    {resolvedImg ? (
                      <Image
                        src={resolvedImg}
                        alt={listing.title}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-3xl">🛍️</div>
                    )}
                    {/* Category badge */}
                    {listing.category?.name && (
                      <span className="absolute top-1.5 left-1.5 bg-black/50 backdrop-blur-sm text-white text-[9px] font-semibold px-2 py-0.5 rounded-full">
                        {listing.category.name}
                      </span>
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-2.5 flex flex-col gap-0.5 flex-1">
                    <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-snug group-hover:text-red-600 transition-colors">
                      {listing.title}
                    </p>
                    <p className="text-[10px] text-gray-400">{listing.location}</p>
                    <div className="mt-auto pt-1.5">
                      <ListingPriceBadge listing={listing} displayCurrency={displayCurrency} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
