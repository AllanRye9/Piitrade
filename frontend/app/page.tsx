import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import HeroSlideshow from '@/components/ui/HeroSlideshow';
import { CategorySideNav, PromoSideCards } from '@/components/ui/HeroSideCards';
import CountryFlashDeals from '@/components/ui/CountryFlashDeals';
import PromoBanners from '@/components/ui/PromoBanners';
import CategoryPills from '@/components/ui/CategoryPills';
import CountryThemedHome from '@/components/ui/CountryThemedHome';
import QuickActions from '@/components/ui/QuickActions';
import HomeOtherCollections from '@/components/ui/HomeOtherCollections';
import TrackPageView from '@/components/ui/TrackPageView';
import SiteAnalytics from '@/components/ui/SiteAnalytics';
import RegionHintBanner from '@/components/ui/RegionHintBanner';
import TodaysDeals from '@/components/ui/TodaysDeals';
import CountryLatestCollections from '@/components/ui/CountryLatestCollections';
import CountryFeaturedDeal from '@/components/ui/CountryFeaturedDeal';
import CountryRecentAcrossCategories from '@/components/ui/CountryRecentAcrossCategories';
import { resolveImageUrl } from '@/lib/utils';

export const metadata: Metadata = {
  title: '3R-Elite Marketplace - Buy & Sell in UAE, Uganda, Kenya & China',
  description: 'Discover premium listings on 3R-Elite: electronics, vehicles, fashion, real estate and more. Trusted marketplace for UAE, Uganda, Kenya and China.',
  openGraph: {
    title: '3R-Elite Marketplace - UAE, Uganda, Kenya & China',
    description: 'Discover premium listings on 3R-Elite. Trusted marketplace for UAE, Uganda, Kenya and China.',
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
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const [listingRes, flashRes, featuredRes, latestCollRes, mediaRes] = await Promise.all([
      fetch(`${apiBase}/api/listings?limit=24&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/listings/flash-sales`, { next: { revalidate: 30 } }),
      fetch(`${apiBase}/api/listings/featured-deal`, { next: { revalidate: 30 } }),
      fetch(`${apiBase}/api/listings/latest-collections?limit=6`, { next: { revalidate: 30 } }),
      fetch(`${apiBase}/api/site-media`, { next: { revalidate: 60 } }),
    ]);
    // Fetch latest per key categories for quick-glance previews
    const [motorsRes, electronicsRes, propertyRes, fashionRes] = await Promise.all([
      fetch(`${apiBase}/api/listings?category=motors&limit=6&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/listings?category=electronics&limit=6&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/listings?category=property&limit=6&sort=createdAt`, { next: { revalidate: 60 } }),
      fetch(`${apiBase}/api/listings?category=fashion&limit=6&sort=createdAt`, { next: { revalidate: 60 } }),
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
    };
  }
}

const features = [
  {
    icon: '🔒',
    title: 'Trusted & Verified',
    desc: 'Every seller is vetted. Secure transactions and verified authenticity.',
    color: 'from-emerald-500 to-teal-600',
  },
  {
    icon: '✦',
    title: 'Curated Selection',
    desc: 'Only the finest listings. Quality over quantity, always.',
    color: 'from-violet-500 to-purple-600',
  },
  {
    icon: '💎',
    title: 'Exclusive Pricing',
    desc: 'Member-only deals and exclusive access to premium collections.',
    color: 'from-amber-500 to-orange-500',
  },
  {
    icon: '🌍',
    title: 'Global Reach',
    desc: 'Connect with elite buyers and sellers across UAE, Uganda, Kenya and China.',
    color: 'from-sky-500 to-blue-600',
  },
];

export default async function HomePage() {
  const { 
    listings, 
    flashListings, 
    featuredDeal, 
    latestCollections, 
    siteMedia, 
    motorsListings = [], 
    electronicsListings = [], 
    propertyListings = [], 
    fashionListings = [] 
  } = await getHomeData();

  const bannerMedia = siteMedia.filter((item) => item.section === 'banner');
  const flashMedia = siteMedia.filter((item) => item.section === 'flash');
  const collectionMedia = siteMedia.filter((item) => item.section === 'collection');

  return (
    <CountryThemedHome>
      <div className="animate-fade-in pb-4">
        {/* Track page views silently on each homepage load */}
        <TrackPageView />
        {/* Region hint banner — shown once per session to inform about country/currency filtering */}
        <RegionHintBanner />
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

        {/* ═══ PAGE ANALYTICS — directly below slider ═══ */}
        <SiteAnalytics />

        {bannerMedia.length > 0 && (
          <section className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 animate-fade-up">
            {bannerMedia.slice(0, 4).map((item) => (
              <a
                key={item.id}
                href={item.linkUrl || '/listings'}
                target={item.linkUrl ? '_blank' : '_self'}
                rel={item.linkUrl ? 'noopener noreferrer' : undefined}
                className="group relative min-h-[160px] overflow-hidden rounded-xl border border-sky-100 shadow-sm block"
              >
                <Image
                  src={resolveImageUrl(item.cdnUrl)}
                  alt={item.altText || 'Promotional banner'}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, 50vw"
                  quality={75}
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
          {/* ═══ 1. FLASH SALES — always first ═══ */}
          <CountryFlashDeals initialListings={flashListings} flashMedia={flashMedia} />

          {/* ═══ 2. RECENT BY CATEGORY (Quick Glance) — second ═══ */}
          <section className="animate-fade-up">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-1 h-6 bg-sky-500 rounded-full inline-block" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-elite-navy">Recent Across Categories</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">Latest items from key marketplaces — glance before you browse deeper</p>
              </div>
              <Link href="/listings" className="text-xs font-semibold text-elite-gold hover:text-elite-gold-dark flex items-center gap-1 interactive">
                View all listings
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

          {/* ═══ 3. CATEGORY PILLS ═══ */}
          <CategoryPills />

          {/* ═══ 4. TODAY'S DEALS (admin-managed) ═══ */}
          <TodaysDeals />

          {/* ═══ 5. LATEST COLLECTIONS ═══ */}
          <section className="animate-fade-up">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-1 h-6 bg-elite-gold rounded-full inline-block" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-elite-navy">Latest Collections</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">Latest curated items</p>
              </div>
              <Link href="/listings" className="text-xs font-semibold text-elite-gold hover:text-elite-gold-dark flex items-center gap-1 interactive">
                View all
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            {collectionMedia.length > 0 && (
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {collectionMedia.slice(0, 3).map((item) =>
                  item.linkUrl ? (
                    <a
                      key={item.id}
                      href={item.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative min-h-[160px] overflow-hidden rounded-xl border border-gray-100 shadow-sm block"
                    >
                      <Image
                        src={resolveImageUrl(item.cdnUrl)}
                        alt={item.altText || 'Collection spotlight'}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        sizes="(max-width: 640px) 50vw, 33vw"
                        quality={75}
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors duration-300 flex items-end justify-end p-2">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-[10px] font-bold text-white bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm">
                          Visit →
                        </span>
                      </div>
                    </a>
                  ) : (
                    <div
                      key={item.id}
                      className="group relative min-h-[160px] overflow-hidden rounded-xl border border-gray-100 shadow-sm"
                    >
                      <Image
                        src={resolveImageUrl(item.cdnUrl)}
                        alt={item.altText || 'Collection spotlight'}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        sizes="(max-width: 640px) 50vw, 33vw"
                        quality={75}
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
          <section className="animate-fade-up rounded-2xl border-2 border-sky-200 bg-gradient-to-r from-sky-50/60 to-indigo-50/40 p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg xs:text-xl font-extrabold text-elite-navy">✦ FEATURED DEAL</h2>
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-extrabold text-white bg-gradient-to-r from-sky-500 to-indigo-500 shadow-sm animate-pulse">
                    HANDPICKED FOR YOU
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">Our premier choice for today. Standout items selected by our experts for exceptional quality and value.</p>
              </div>
              <Link href="/listings?placement=FEATURED_DEAL" className="text-xs font-semibold text-white bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-600 hover:to-indigo-600 px-3 py-1.5 rounded-lg flex items-center gap-1 interactive shadow-sm transition-all">
                View All Deals
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
                  <span className="w-1 h-6 bg-sky-500 rounded-full inline-block" />
                  <h2 className="text-lg xs:text-xl font-extrabold text-elite-navy">Other Collections</h2>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-3">Explore more listings from our marketplace</p>
              </div>
              <Link href="/listings" className="text-xs font-semibold text-elite-gold hover:text-elite-gold-dark flex items-center gap-1 interactive">
                View all
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            {listings.length > 0 && (
              <HomeOtherCollections fallbackListings={listings} />
            )}
          </section>

          {/* ═══ 9. MARKET CTAs ═══ */}
          <PromoBanners />

          {/* ═══ 10. QUICK ACTIONS ═══ */}
          <QuickActions />

          {/* ═══ SAFETY BANNER ═══ */}
          <section className="bg-elite-cream border border-[#0369a1]/15 rounded-xl p-4 xs:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 xs:gap-4">
            <div className="shrink-0 w-10 h-10 xs:w-12 xs:h-12 rounded-xl bg-[#0369a1]/10 flex items-center justify-center text-2xl">
              🛡️
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-elite-navy text-sm xs:text-base mb-0.5">Community Safety Comes First</h3>
              <p className="text-gray-600 text-xs xs:text-sm">
                Always meet in a public place, never pay in advance without inspecting, and report suspicious listings.
                Together, we build a safer marketplace.
              </p>
            </div>
            <Link
              href="/safety"
              className="shrink-0 text-xs font-semibold text-elite-navy bg-[#0369a1]/10 hover:bg-[#0369a1]/20 border border-[#0369a1]/20 px-3 py-1.5 rounded-lg transition-colors interactive"
            >
              Safety Tips →
            </Link>
          </section>

          {/* ═══ GET VERIFIED CTA ═══ */}
          <section className="relative overflow-hidden bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 rounded-xl px-4 xs:px-6 py-6 xs:py-8 sm:px-10 text-white">
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
              <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
              <div className="absolute -bottom-8 -left-8 w-48 h-48 bg-white/10 rounded-full blur-2xl" />
            </div>
            <div className="relative flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
              <div className="shrink-0 w-14 h-14 xs:w-16 xs:h-16 bg-white/20 rounded-2xl flex items-center justify-center text-3xl">
                ✅
              </div>
              <div className="text-center sm:text-left flex-1">
                <h2 className="text-lg xs:text-xl font-extrabold mb-1">Join the Inner Circle — Unlock Exclusive Access</h2>
                <p className="text-white/80 text-xs xs:text-sm max-w-md">
                  Verified members get early access to limited drops,
                  exclusive pricing, and a trust badge on every listing.
                </p>
                <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-2 xs:mt-3 text-xs text-white/80">
                  <span className="flex items-center gap-1"><span className="text-yellow-300">✓</span> Priority access</span>
                  <span className="flex items-center gap-1"><span className="text-yellow-300">✓</span> Verified badge</span>
                  <span className="flex items-center gap-1"><span className="text-yellow-300">✓</span> Member pricing</span>
                </div>
              </div>
              <Link
                href="/profile/subscription"
                className="shrink-0 bg-white text-violet-700 font-bold px-5 py-2.5 rounded-xl hover:bg-yellow-300 hover:text-violet-900 transition-all interactive shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-sm whitespace-nowrap"
              >
                Join Now →
              </Link>
            </div>
          </section>

          {/* ═══ WHY 3R-ELITE ═══ */}
          <section className="bg-white rounded-lg border border-gray-100 shadow-sm p-4 xs:p-6 sm:p-8">
            <div className="text-center mb-4 xs:mb-6">
              <h2 className="text-lg xs:text-xl font-extrabold text-elite-navy">Why Choose 3R-Elite?</h2>
              <p className="text-gray-500 text-xs xs:text-sm mt-1">The refined way to buy and sell</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 xs:gap-4 stagger-children">
              {features.map((f) => (
                <div key={f.title} className="text-center group">
                  <div className={`w-10 h-10 xs:w-12 xs:h-12 mx-auto mb-2 xs:mb-3 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-xl xs:text-2xl shadow-lg group-hover:scale-110 group-hover:shadow-xl transition-all duration-300`}>
                    <span>{f.icon}</span>
                  </div>
                  <h3 className="font-bold text-elite-navy text-xs xs:text-sm mb-0.5 xs:mb-1">{f.title}</h3>
                  <p className="text-[10px] xs:text-xs text-gray-500 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ═══ POST AD CTA ═══ */}
          <section className="relative overflow-hidden bg-gradient-to-r from-orange-500 via-rose-500 to-pink-600 rounded-lg px-4 xs:px-6 py-6 xs:py-8 sm:px-10 text-white text-center">
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
              <div className="absolute top-0 left-1/4 w-24 xs:w-32 h-24 xs:h-32 bg-white/10 rounded-full blur-xl" />
              <div className="absolute bottom-0 right-1/4 w-32 xs:w-40 h-32 xs:h-40 bg-white/10 rounded-full blur-xl" />
            </div>
            <div className="relative">
              <p className="text-3xl xs:text-4xl mb-2 xs:mb-3">🚀</p>
              <h2 className="text-xl xs:text-2xl font-extrabold mb-1.5 xs:mb-2">Ready to List?</h2>
              <p className="text-white/80 text-xs xs:text-sm mb-4 xs:mb-5 max-w-sm mx-auto">
                Showcase your premium items to discerning buyers across UAE, Uganda, Kenya and China.
              </p>
              <Link
                href="/listings/create"
                className="inline-flex items-center gap-2 bg-white text-rose-600 font-bold px-6 py-3 rounded-lg hover:bg-yellow-300 hover:text-rose-700 transition-all interactive shadow-lg hover:shadow-xl hover:-translate-y-0.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Create Listing
              </Link>
            </div>
          </section>
        </div>
      </div>
    </CountryThemedHome>
  );
}