import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import HeroSlideshow from '@/components/ui/HeroSlideshow';
import MobileCategoryGrid from '@/components/ui/MobileCategoryGrid';
import { CategorySideNav, PromoSideCards } from '@/components/ui/HeroSideCards';
import CountryFlashDeals from '@/components/ui/CountryFlashDeals';
import CountryThemedHome from '@/components/ui/CountryThemedHome';
import QuickActions from '@/components/ui/QuickActions';
import HomeOtherCollections from '@/components/ui/HomeOtherCollections';
import TrackPageView from '@/components/ui/TrackPageView';
import BlogPopup from '@/components/ui/BlogPopup';
import RegionHintBanner from '@/components/ui/RegionHintBanner';
import CountryLatestCollections from '@/components/ui/CountryLatestCollections';
import CountryFeaturedDeal from '@/components/ui/CountryFeaturedDeal';
import CountryRecentAcrossCategories from '@/components/ui/CountryRecentAcrossCategories';
import FeaturedStoresRow, { type FeaturedStore } from '@/components/ui/FeaturedStoresRow';
import BackToSchoolSection from '@/components/ui/BackToSchoolSection';
import { resolveImageUrl } from '@/lib/utils';
import { API_URL } from '@/lib/apiUrl';
import { getIntlayer } from 'intlayer';
import { getLocale } from 'next-intlayer/server';

export const metadata: Metadata = {
  title: 'Piitrade Marketplace - Buy & Sell in Uganda',
  description: 'Discover premium listings on Piitrade: electronics, vehicles, fashion, real estate and more. Trusted marketplace for Uganda.',
  openGraph: {
    title: 'Piitrade Marketplace - Uganda',
    description: 'Discover premium listings on Piitrade. Trusted marketplace for Uganda.',
  },
};

import type { Listing } from '@/lib/types';

interface SiteMediaItem {
  id: string;
  section: 'hero' | 'banner' | 'featured' | 'flash' | 'collection' | 'background' | 'category';
  cdnUrl: string;
  title?: string | null;
  shortDescription?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  currency?: 'AED' | 'UGX' | 'KES' | 'CNY' | 'USD' | null;
  altText?: string | null;
  linkUrl?: string | null;
  sortOrder: number;
}

async function getHomeData() {
  try {
    const apiBase = API_URL;
    const [listingRes, flashRes, featuredRes, latestCollRes, mediaRes] = await Promise.all([
      fetch(`${apiBase}/api/listings?limit=24&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/listings/flash-sales`, { next: { revalidate: 30 } }),
      fetch(`${apiBase}/api/listings/featured-deal`, { next: { revalidate: 30 } }),
      fetch(`${apiBase}/api/listings/latest-collections?limit=6`, { next: { revalidate: 30 } }),
      fetch(`${apiBase}/api/site-media`, { next: { revalidate: 60 } }),
    ]);
    // Fetch latest per key categories for quick-glance previews
    const [motorsRes, electronicsRes, propertyRes, fashionRes, storesRes] = await Promise.all([
      fetch(`${apiBase}/api/listings?category=motors&limit=6&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/listings?category=electronics&limit=6&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/listings?category=property&limit=6&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/listings?category=fashion&limit=6&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/stores?limit=8`, { next: { revalidate: 120 } }),
    ]);
    const listingData: { listings: Listing[] } = listingRes.ok ? await listingRes.json() : { listings: [] };
    const flashData: { listings: Listing[] } = flashRes.ok ? await flashRes.json() : { listings: [] };
    const featuredDeal = featuredRes.ok ? await featuredRes.json() : null;
    const latestCollData: { listings: Listing[] } = latestCollRes.ok ? await latestCollRes.json() : { listings: [] };
    const siteMediaData: { media: SiteMediaItem[] } = mediaRes.ok ? await mediaRes.json() : { media: [] };
    const motorsData: { listings: Listing[] } = motorsRes.ok ? await motorsRes.json() : { listings: [] };
    const electronicsData: { listings: Listing[] } = electronicsRes.ok ? await electronicsRes.json() : { listings: [] };
    const propertyData: { listings: Listing[] } = propertyRes.ok ? await propertyRes.json() : { listings: [] };
    const fashionData: { listings: Listing[] } = fashionRes.ok ? await fashionRes.json() : { listings: [] };
    const storesData: { stores: FeaturedStore[] } = storesRes.ok ? await storesRes.json() : { stores: [] };

    return {
      listings: listingData.listings || [],
      flashListings: flashData.listings || [],
      featuredDeal,
      latestCollections: latestCollData.listings || [],
      siteMedia: siteMediaData.media || [],
      motorsListings: motorsData.listings || [],
      electronicsListings: electronicsData.listings || [],
      propertyListings: propertyData.listings || [],
      fashionListings: fashionData.listings || [],
      featuredStores: storesData.stores || [],
    };
  } catch {
    return { 
      listings: [], 
      flashListings: [], 
      featuredDeal: null, 
      latestCollections: [], 
      siteMedia: [],
      motorsListings: [],
      electronicsListings: [],
      propertyListings: [],
      fashionListings: [],
      featuredStores: [] as FeaturedStore[],
    };
  }
}

const features = [
  {
    icon: '🔒',
    title: 'Trusted & Verified',
    desc: 'Every seller is vetted. Secure transactions and verified authenticity.',
    color: 'from-[#FF6500] to-premium-navy',
  },
  {
    icon: '✦',
    title: 'Curated Selection',
    desc: 'Only the finest listings. Quality over quantity, always.',
    color: 'from-[#9A3300] to-[#6B2400]',
  },
  {
    icon: '💎',
    title: 'Exclusive Pricing',
    desc: 'Member-only deals and exclusive access to premium collections.',
    color: 'from-premium-gold to-premium-gold-dark',
  },
  {
    icon: '🇺🇬',
    title: 'Nationwide Reach',
    desc: 'Connect with trusted buyers and sellers across Uganda.',
    color: 'from-[#E94B00] to-[#FF6500]',
  },
];

export default async function HomePage() {
  const locale = await getLocale();
  const t = getIntlayer('home-page', locale);
  const {
    listings, 
    flashListings, 
    featuredDeal, 
    latestCollections, 
    siteMedia, 
    motorsListings = [], 
    electronicsListings = [], 
    propertyListings = [], 
    fashionListings = [],
    featuredStores = [],
  } = await getHomeData();

  const bannerMedia = siteMedia.filter((item) => item.section === 'banner');
  const flashMedia = siteMedia.filter((item) => item.section === 'flash');
  const collectionMedia = siteMedia.filter((item) => item.section === 'collection');

  return (
    <CountryThemedHome>
      <div className="animate-fade-in pb-4">
        {/* Track page views silently on each homepage load */}
        <TrackPageView />
        <BlogPopup />
        {/* Region hint banner — shown once per session to inform about country/currency filtering */}
        <RegionHintBanner />

        {/* ═══ MOBILE CATEGORY GRID ═══
            Sits directly under the header's tagline strip on phones, mirroring
            the icon-grid-then-promo-carousel structure of the reference
            mobile layout. Desktop keeps its existing CategoryBar mega-menu
            instead, so this is mobile-only. */}
        <MobileCategoryGrid />

        {/* ═══ HERO ═══ */}
        <section className="p-[6px]">
          <div className="flex items-stretch gap-2 min-h-[260px] sm:min-h-[310px] max-h-[370px]">
            {/* Left: Category Navigation */}
            <div className="hidden lg:block w-[180px] xl:w-[195px] flex-shrink-0 overflow-hidden">
              <CategorySideNav />
            </div>
            {/* Center: Slideshow */}
            <div className="flex-1 relative overflow-hidden min-h-[260px] sm:min-h-[310px]">
              <HeroSlideshow />
            </div>
            {/* Right: Promo Cards */}
            <div className="hidden lg:flex w-[170px] xl:w-[185px] flex-shrink-0 flex-col">
              <PromoSideCards />
            </div>
          </div>
        </section>

        {/* ═══ UGANDA MARKET PRICES + WHOLESALE MARKETPLACE — both merged
            into the single /market-prices page and intentionally removed
            from the homepage. That page (reference prices + the bulk
            commodity marketplace) targets wholesalers, manufacturers, and
            brokers dealing in large quantities, whereas the homepage is
            built for everyday consumers/retailers — see
            components/ui/HomeMarketPrices.tsx and
            components/ui/HomeFarmerMarketplace.tsx (now unused here, left
            in place rather than deleted in case any other page still links
            to them) for the previous teaser widgets this replaced. ═══ */}

        {bannerMedia.length > 0 && (
          <section className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 animate-fade-up">
            {bannerMedia.slice(0, 4).map((item) => (
              <a
                key={item.id}
                href={item.linkUrl || '/listings'}
                target={item.linkUrl ? '_blank' : '_self'}
                rel={item.linkUrl ? 'noopener noreferrer' : undefined}
                className="group relative min-h-[160px] overflow-hidden rounded-xl border border-red-100 shadow-sm block"
              >
                <Image
                  src={resolveImageUrl(item.cdnUrl)}
                  alt={item.altText || 'Promotional banner'}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, 50vw"
                  quality={92}
                  loading="lazy"
                />
                {item.linkUrl && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                )}
              </a>
            ))}
          </section>
        )}

        <div className="py-3 space-y-5 sm:space-y-6">
          {/* ═══ 1. FLASH DEALS — always first ═══ */}
          <CountryFlashDeals initialListings={flashListings} flashMedia={flashMedia} />

          {/* ═══ 1a. BACK TO SCHOOL — mobile-only discounted picks strip,
              matching the reference layout's flash-sale-adjacent placement.
              Self-hides when there's nothing discounted to show. ═══ */}
          <BackToSchoolSection />

          {/* ═══ 1b. TRUSTED SELLERS — "Big brands near you" equivalent ═══ */}
          <FeaturedStoresRow stores={featuredStores} />

          {/* ═══ 2. RECENT BY CATEGORY (Quick Glance) — second ═══ */}
          <section className="animate-fade-up">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-1 h-6 bg-red-500 rounded-full inline-block shrink-0" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">{t.recentAcrossCategories.heading}</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">{t.recentAcrossCategories.subtitle}</p>
              </div>
              <Link href="/listings" className="self-start sm:self-auto shrink-0 text-xs font-semibold text-premium-gold hover:text-premium-gold-dark flex items-center gap-1 interactive">
                {t.recentAcrossCategories.viewAll}
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            <CountryRecentAcrossCategories
              initialMotors={motorsListings}
              initialElectronics={electronicsListings}
              initialProperty={propertyListings}
              initialFashion={fashionListings}
            />
          </section>

          {/* ═══ 3. LATEST COLLECTIONS ═══ */}
          <section className="animate-fade-up">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-1 h-6 bg-premium-gold rounded-full inline-block shrink-0" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">{t.latestCollections.heading}</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">{t.latestCollections.subtitle}</p>
              </div>
              <Link href="/listings" className="self-start sm:self-auto shrink-0 text-xs font-semibold text-premium-gold hover:text-premium-gold-dark flex items-center gap-1 interactive">
                {t.latestCollections.viewAll}
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            {collectionMedia.length > 0 && (
              <div className="mb-2 grid grid-cols-3 gap-2">
                {collectionMedia.slice(0, 3).map((item) =>
                  item.linkUrl ? (
                    <a
                      key={item.id}
                      href={item.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative min-h-[100px] xs:min-h-[130px] sm:min-h-[160px] overflow-hidden rounded-xl border border-gray-100 shadow-sm block"
                    >
                      <Image
                        src={resolveImageUrl(item.cdnUrl)}
                        alt={item.altText || 'Collection spotlight'}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        sizes="33vw"
                        quality={92}
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors duration-300 flex items-end justify-end p-2">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-[10px] font-bold text-white bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm">
                          {t.latestCollections.visit} →
                        </span>
                      </div>
                    </a>
                  ) : (
                    <div
                      key={item.id}
                      className="group relative min-h-[100px] xs:min-h-[130px] sm:min-h-[160px] overflow-hidden rounded-xl border border-gray-100 shadow-sm"
                    >
                      <Image
                        src={resolveImageUrl(item.cdnUrl)}
                        alt={item.altText || 'Collection spotlight'}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        sizes="33vw"
                        quality={92}
                        loading="lazy"
                      />
                    </div>
                  )
                )}
              </div>
            )}
            {latestCollections.length > 0 && (
              <CountryLatestCollections initialListings={latestCollections} />
            )}
          </section>

          {/* ═══ 7. FEATURED DEAL — 6 items per row ═══ */}
          <section className="animate-fade-up rounded-2xl border-2 border-red-200 bg-gradient-to-r from-red-50/60 to-rose-50/40 p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">✦ {t.featuredDeal.heading}</h2>
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold text-white bg-gradient-to-r from-red-500 to-rose-500 shadow-sm animate-pulse uppercase">
                    {t.featuredDeal.handpickedBadge}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{t.featuredDeal.subtitle}</p>
              </div>
              <Link href="/listings?placement=FEATURED_DEAL" className="self-start sm:self-auto shrink-0 text-xs font-semibold text-white bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 px-3 py-1.5 rounded-lg flex items-center gap-1 interactive shadow-sm transition-all">
                {t.featuredDeal.viewAllDeals}
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            <CountryFeaturedDeal initialDeal={featuredDeal as import('@/lib/types').Listing | null} />
          </section>

          {/* ═══ 8. OTHER COLLECTIONS ═══ */}
          <section className="animate-fade-up bg-gray-50/80 rounded-2xl p-3 sm:p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-1 h-6 bg-red-500 rounded-full inline-block" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">Other Collections</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">Explore more listings from our marketplace</p>
              </div>
              <Link href="/listings" className="text-xs font-semibold text-premium-gold hover:text-premium-gold-dark flex items-center gap-1 interactive">
                View all
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            {listings.length > 0 && (
              <HomeOtherCollections fallbackListings={listings} />
            )}
          </section>

          {/* ═══ 9. QUICK ACTIONS ═══ */}
          <QuickActions />

          {/* ═══ TRUST STRIP — safety note + "why Piitrade" highlights folded into one
               compact row. These don't surface listings, so they no longer get two
               separate full-width sections' worth of space; all the same links and
               highlights are still here, just presented as a single slim strip. ═══ */}
          <section className="bg-white rounded-xl border border-gray-100 p-3 xs:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
              <div className="flex items-start gap-2.5 sm:shrink-0 sm:max-w-xs">
                <span className="text-xl shrink-0" aria-hidden="true">🛡️</span>
                <p className="text-xs text-gray-600 leading-snug">
                  Meet in public, inspect before paying.{' '}
                  <Link href="/safety" className="font-semibold text-premium-navy hover:underline interactive">Safety Tips →</Link>
                </p>
              </div>
              <div className="hidden sm:block w-px self-stretch bg-gray-100" aria-hidden="true" />
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 flex-1">
                {features.map((f) => (
                  <span key={f.title} className="flex items-center gap-1.5 text-xs font-medium text-gray-600" title={f.desc}>
                    <span aria-hidden="true">{f.icon}</span> {f.title}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* ═══ CONVERSION STRIP — Get Verified + Post Ad combined into one compact
               two-up row instead of two large full-width banners. Same links and
               copy, just repositioned into far less vertical space. ═══ */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-premium-navy via-[#9A3300] to-[#6B2400] text-white p-3.5 xs:p-4 flex items-center gap-3">
              <span className="text-2xl shrink-0" aria-hidden="true">🪪</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm leading-tight">Get KYC Verified</h3>
                <p className="text-red-100/80 text-xs leading-snug">Priority review &amp; a trust badge buyers spot instantly.</p>
              </div>
              <Link
                href="/profile/verification"
                className="shrink-0 bg-premium-gold text-white font-bold px-3 py-2 rounded-lg hover:bg-premium-gold-dark transition-colors interactive text-xs whitespace-nowrap"
              >
                Verify →
              </Link>
            </div>
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-premium-gold-dark via-premium-gold to-premium-gold-light text-white p-3.5 xs:p-4 flex items-center gap-3">
              <span className="text-2xl shrink-0" aria-hidden="true">🚀</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm leading-tight">Ready to List?</h3>
                <p className="text-white/85 text-xs leading-snug">Showcase your items to buyers across the region.</p>
              </div>
              <Link
                href="/listings/create"
                className="shrink-0 bg-white text-premium-gold-dark font-bold px-3 py-2 rounded-lg hover:bg-premium-navy hover:text-white transition-colors interactive text-xs whitespace-nowrap"
              >
                Create →
              </Link>
            </div>
          </section>
        </div>
      </div>
    </CountryThemedHome>
  );
}