import { Fragment } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import HeroSlideshow from '@/components/ui/HeroSlideshow';
import MobileCategoryGrid from '@/components/ui/MobileCategoryGrid';
import HomeCategoryTiles from '@/components/ui/HomeCategoryTiles';
import { CategorySideNav, PromoSideCards } from '@/components/ui/HeroSideCards';
import HomeAgriculturalSection from '@/components/ui/HomeAgriculturalSection';
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
import TodaysDeals from '@/components/ui/TodaysDeals';
import FlashDealsSection from '@/components/ui/FlashDealsSection';
import { resolveImageUrl } from '@/lib/utils';
import { API_URL } from '@/lib/apiUrl';
import HomeCustomCollection, { type HomeCollection } from '@/components/ui/HomeCustomCollection';
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
  currency?: 'UGX' | null;
  altText?: string | null;
  linkUrl?: string | null;
  sortOrder: number;
}

interface HomeLayoutResponse {
  order: string[];
  settings: Record<string, { enabled: boolean; title?: string; subtitle?: string }>;
  collections: HomeCollection[];
}

/** Used when the layout request fails: the original page, in its original order. */
const DEFAULT_ORDER = [
  'flash-deals', 'todays-deals', 'agriculture', 'back-to-school', 'featured-stores', 'recent-by-category',
  'latest-collections', 'featured-deal', 'other-collections', 'quick-actions', 'trust-strip', 'conversion-strip',
];

/** One request with a hard time limit, so a slow API can never hold the whole page hostage. */
async function getJson<T>(path: string, revalidate: number, fallback: T, timeoutMs = 4000): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate }, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function getHomeData() {
  // Everything in ONE parallel batch (it used to be two batches, the second waiting for the first).
  const none = { listings: [] as Listing[] };
  const [listingData, featuredDeal, latestCollData, siteMediaData, motorsData, electronicsData, propertyData, fashionData, storesData, agricultureData, layout] =
    await Promise.all([
      getJson<{ listings: Listing[] }>('/api/listings?limit=24&sort=createdAt', 60, none),
      getJson<Listing | null>('/api/listings/featured-deal', 30, null),
      getJson<{ listings: Listing[] }>('/api/listings/latest-collections?limit=12', 30, none),
      getJson<{ media: SiteMediaItem[] }>('/api/site-media', 60, { media: [] }),
      getJson<{ listings: Listing[] }>('/api/listings?category=motors&limit=12&sort=createdAt', 60, none),
      getJson<{ listings: Listing[] }>('/api/listings?category=electronics&limit=12&sort=createdAt', 60, none),
      getJson<{ listings: Listing[] }>('/api/listings?category=property&limit=12&sort=createdAt', 60, none),
      getJson<{ listings: Listing[] }>('/api/listings?category=fashion&limit=12&sort=createdAt', 60, none),
      getJson<{ stores: FeaturedStore[] }>('/api/stores?limit=8', 120, { stores: [] }),
      getJson<{ listings: Listing[] }>('/api/listings?category=agriculture&limit=12&sort=createdAt', 60, none),
      getJson<HomeLayoutResponse | null>('/api/home-layout', 30, null),
    ]);

  return {
    listings: listingData.listings || [],
    featuredDeal,
    latestCollections: latestCollData.listings || [],
    siteMedia: siteMediaData.media || [],
    motorsListings: motorsData.listings || [],
    electronicsListings: electronicsData.listings || [],
    propertyListings: propertyData.listings || [],
    fashionListings: fashionData.listings || [],
    featuredStores: storesData.stores || [],
    agricultureListings: agricultureData.listings || [],
    layout: layout && Array.isArray(layout.order) ? layout : { order: DEFAULT_ORDER, settings: {}, collections: [] as HomeCollection[] },
  };
}

const features = [
  {
    icon: '🔒',
    title: 'Trusted & Verified',
    desc: 'Every seller is vetted. Verified sellers and safety tips for every meetup.',
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
    featuredDeal, 
    latestCollections, 
    siteMedia, 
    motorsListings = [], 
    electronicsListings = [], 
    propertyListings = [], 
    fashionListings = [],
    featuredStores = [],
    agricultureListings = [],
    layout,
  } = await getHomeData();

  const bannerMedia = siteMedia.filter((item) => item.section === 'banner');
  const collectionMedia = siteMedia.filter((item) => item.section === 'collection');

  // Per-section overrides saved by the admin (title / subtitle on the sections that allow it).
  const ov = (key: string): { title?: string; subtitle?: string } => layout.settings[key] ?? {};
  const collectionsById = new Map(layout.collections.map((c) => [c.id, c]));
  const builtIn: Record<string, React.ReactNode> = {
    'flash-deals': (<FlashDealsSection />),
    'todays-deals': (<TodaysDeals />),
    'agriculture': (<HomeAgriculturalSection initialListings={agricultureListings} />),
    'back-to-school': (<BackToSchoolSection />),
    'featured-stores': (<FeaturedStoresRow stores={featuredStores} />),
    'recent-by-category': (
          <section className="animate-fade-up">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-1 h-6 bg-red-500 rounded-full inline-block shrink-0" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">{ov('recent-by-category').title ?? t.recentAcrossCategories.heading}</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">{ov('recent-by-category').subtitle ?? t.recentAcrossCategories.subtitle}</p>
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

    ),
    'latest-collections': (
          <section className="animate-fade-up">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-1 h-6 bg-premium-gold rounded-full inline-block shrink-0" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">{ov('latest-collections').title ?? t.latestCollections.heading}</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">{ov('latest-collections').subtitle ?? t.latestCollections.subtitle}</p>
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

    ),
    'featured-deal': (
          <section className="animate-fade-up rounded-2xl border-2 border-red-200 bg-gradient-to-r from-red-50/60 to-rose-50/40 p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">✦ {ov('featured-deal').title ?? t.featuredDeal.heading}</h2>
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold text-white bg-gradient-to-r from-red-500 to-rose-500 shadow-sm animate-pulse uppercase">
                    {t.featuredDeal.handpickedBadge}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{ov('featured-deal').subtitle ?? t.featuredDeal.subtitle}</p>
              </div>
              <Link href="/listings?placement=FEATURED_DEAL" className="self-start sm:self-auto shrink-0 text-xs font-semibold text-white bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 px-3 py-1.5 rounded-lg flex items-center gap-1 interactive shadow-sm transition-all">
                {t.featuredDeal.viewAllDeals}
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            <CountryFeaturedDeal initialDeal={featuredDeal as import('@/lib/types').Listing | null} />
          </section>

    ),
    'other-collections': (
          <section className="animate-fade-up bg-gray-50/80 rounded-2xl p-3 sm:p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-1 h-6 bg-red-500 rounded-full inline-block" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">{ov('other-collections').title ?? 'Other Collections'}</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">{ov('other-collections').subtitle ?? 'Explore more listings from our marketplace'}</p>
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

    ),
    'quick-actions': (<QuickActions />),
    'trust-strip': (
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

    ),
    'conversion-strip': (
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
          </section>    ),
  };

  return (
    <CountryThemedHome>
      <div className="animate-fade-in pb-2 px-2 lg:px-4">
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

        {/* ═══ BROWSE BY CATEGORY (tablet/desktop) — icon tiles with live item counts ═══ */}
        <HomeCategoryTiles />

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

        {/* Sections are rendered in the order set at Admin → Homepage Layout → Sections; hidden ones are skipped. */}
        <div className="py-2 space-y-3 sm:space-y-4">
          {layout.order.map((key) => {
            if (key.startsWith('custom:')) {
              const c = collectionsById.get(key.slice(7));
              return c ? <HomeCustomCollection key={key} collection={c} /> : null;
            }
            if (layout.settings[key]?.enabled === false) return null;
            const node = builtIn[key];
            return node ? <Fragment key={key}>{node}</Fragment> : null;
          })}
        </div>
      </div>
    </CountryThemedHome>
  );
}