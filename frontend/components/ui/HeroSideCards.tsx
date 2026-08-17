'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import { useSiteConfig } from '@/context/SiteConfigContext';
import { useAuth } from '@/context/AuthContext'; // needed for Sell on Piitrade auth-aware routing
import { useCountry } from '@/context/CountryContext';
import { useActiveSubcategoryCounts } from '@/hooks/useActiveSubcategoryCounts';
import { resolveImageUrl } from '@/lib/utils';

interface NavCategory {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const navCategories: NavCategory[] = [
  {
    label: 'Official Stores',
    href: '/stores',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016 2.993 2.993 0 0 0 2.25-1.016 3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
      </svg>
    ),
  },
  {
    label: 'Phones & Tablets',
    href: '/electronics/smartphones',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3" />
      </svg>
    ),
  },
  {
    label: 'Electronics',
    href: '/electronics',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
      </svg>
    ),
  },
  {
    label: 'Appliances',
    href: '/classifieds/appliances',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
      </svg>
    ),
  },
  {
    label: 'Home & Garden',
    href: '/furniture',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    label: 'Fashion',
    href: '/fashion',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
      </svg>
    ),
  },
  {
    label: 'Computing',
    href: '/electronics/laptops',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 7.409A2.25 2.25 0 0 1 2.25 5.493V5.25" />
      </svg>
    ),
  },
  {
    label: 'Health & Beauty',
    href: '/listings?category=health-beauty',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
      </svg>
    ),
  },
  {
    label: 'Supermarket',
    href: '/listings?category=food-beverages',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
      </svg>
    ),
  },
  {
    label: 'Gaming',
    href: '/electronics/consoles',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 0 1-.657.643 48.39 48.39 0 0 1-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 0 1-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 0 0-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 0 1-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 0 0 .657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 0 1-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 0 0 5.427-.63 48.05 48.05 0 0 0 .582-4.717.532.532 0 0 0-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 0 0 .658-.663 48.422 48.422 0 0 0-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 0 1-.61-.58v0Z" />
      </svg>
    ),
  },
  {
    label: 'Baby Products',
    href: '/classifieds/kids-baby',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
      </svg>
    ),
  },
  {
    label: 'Other Categories',
    href: '/listings',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
];

// Routes in this sidebar that are never category-specific — a general
// browse-everything page or another section of the site entirely — so they
// should never be hidden by the empty-category rule.
const NON_CATEGORY_ROUTES = new Set(['listings', 'stores']);

// Resolves the category slug an "All Categories" sidebar item points to, so
// it can be checked against the active-listing-counts map. Returns null for
// links that aren't tied to a single specific category (e.g. "/stores", the
// bare "/listings" catch-all) — those are never hidden since there's no
// single section whose emptiness should hide them.
function resolveCategorySlug(href: string): string | null {
  const url = new URL(href, 'http://x');
  const categoryParam = url.searchParams.get('category');
  if (categoryParam) return categoryParam;
  if (url.search) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return null;
  if (NON_CATEGORY_ROUTES.has(segments[0])) return null;
  return segments[segments.length - 1];
}

export function CategorySideNav() {
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const { country } = useCountry();
  const { counts } = useActiveSubcategoryCounts(country);

  // Hide sidebar entries whose target category/subcategory has zero ACTIVE
  // listings, so every visible link leads somewhere with content. Falls back
  // to showing everything while counts are loading or if the request fails.
  const visibleNavCategories = useMemo(() => {
    if (!counts) return navCategories;
    return navCategories.filter((cat) => {
      const slug = resolveCategorySlug(cat.href);
      if (!slug) return true;
      return (counts[slug] ?? 0) > 0;
    });
  }, [counts]);

  return (
    <>
      {/* isolation: isolate keeps the side nav in its own compositing layer so
          hover animations here never cause repaints in the adjacent slideshow. */}
      <div
        className="h-full flex flex-col bg-white shadow-md rounded-sm"
        style={{ isolation: 'isolate', transform: 'translateZ(0)' }}
      >
        {/* Header */}
        <div className="bg-premium-navy text-white px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider flex items-center gap-2 shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
          All Categories
        </div>
        {/* Category list — compact so all items fit without scrolling at normal zoom */}
        <ul className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {visibleNavCategories.map((cat) => {
            const isActive = activeHref === cat.href;
            return (
              <li key={cat.label}>
                <Link
                  href={cat.href}
                  onClick={() => setActiveHref(cat.href)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] transition-colors duration-200 group ${
                    isActive
                      ? 'bg-premium-navy text-white'
                      : 'text-gray-700 hover:bg-premium-gold/15 hover:text-premium-navy active:bg-premium-navy active:text-white'
                  }`}
                >
                  <span className={`shrink-0 transition-colors duration-150 ${isActive ? 'text-premium-gold' : 'text-gray-400 group-hover:text-premium-navy'}`}>
                    {cat.icon}
                  </span>
                  <span className="truncate font-medium">{cat.label}</span>
                  <svg
                    className={`w-2.5 h-2.5 ml-auto shrink-0 transition-all duration-200 ${isActive ? 'text-premium-gold' : 'text-gray-300 group-hover:text-premium-navy group-hover:translate-x-0.5'}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

export function PromoSideCards() {
  const { whatsappNumber, promoVideoUrl } = useSiteConfig();
  const { user } = useAuth(); // used for auth-aware routing on Sell on Piitrade
  // Route authenticated users to the store setup page; guests go to registration with store intent
  const sellHref = user ? '/dashboard/store-rental' : '/auth/register?intent=store';
  const waHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber.replace(/\D/g, '')}?text=Hi%20I%27d%20like%20to%20order%20from%20Piitrade`
    : 'https://wa.me/?text=Hi%20I%20found%20you%20on%20Piitrade';
  // Admin can upload a video from /admin/settings (SiteConfig.promoVideoUrl);
  // when none has been uploaded yet, we show a branded placeholder instead
  // of a video element (see videoSrc check below).
  const videoSrc = promoVideoUrl ? resolveImageUrl(promoVideoUrl) : null;
  return (
    <div
      className="h-full flex flex-col gap-2 pl-2"
    >
      {/* Info cards — white card with 3 clickable rows */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden flex-none">
        {/* WhatsApp */}
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-3 border-b border-gray-100 hover:bg-green-50 active:bg-green-100 transition-colors group"
        >
          <span className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0 group-hover:bg-green-200 transition-colors">
            <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-gray-800">WhatsApp</div>
            <div className="text-[10px] text-gray-500">Chat To Order</div>
          </div>
        </a>

        {/* Today's Deals — links to the main listings page; the homepage Today's Deals section
            is powered by admin-managed deals (SiteConfig) not by listing placement filters,
            so /listings is the correct fallback that always shows content */}
        <Link
          href="/listings"
          className="flex items-center gap-3 px-3 py-3 border-b border-gray-100 hover:bg-amber-50 active:bg-amber-100 transition-colors group"
        >
          <span className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0 group-hover:bg-amber-200 transition-colors">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-gray-800">Today&apos;s Deals</div>
            <div className="text-[10px] text-gray-500">Exclusive Prices</div>
          </div>
        </Link>

        {/* Sell on Piitrade — sends logged-in users to store setup, guests to registration */}
        <Link
          href={sellHref}
          className="flex items-center gap-3 px-3 py-3 hover:bg-sky-50 active:bg-sky-100 transition-colors group"
        >
          <span className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center shrink-0 group-hover:bg-sky-200 transition-colors">
            <svg className="w-5 h-5 text-premium-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016 2.993 2.993 0 0 0 2.25-1.016 3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold text-premium-navy uppercase tracking-wide">Sell on Piitrade</div>
            <div className="text-[10px] text-gray-500">Millions Of Visitors</div>
          </div>
        </Link>
      </div>

      {/* Promo video block — fills remaining height. Source is admin-configurable
          from /admin/settings (SiteConfig.promoVideoUrl); shows a branded
          placeholder when no video has been uploaded. Keyed on
          videoSrc so the <video> element remounts and loads the new source
          when an admin updates it, since React won't otherwise pick up a
          changed `src` on a native element it's already rendered. */}
      <div className="relative flex-1 rounded-lg overflow-hidden shadow-glow min-h-32">
        {videoSrc ? (
          <video
            key={videoSrc}
            src={videoSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 w-full h-full object-cover"
            aria-label="Piitrade promo video"
          >
            <div className="absolute inset-0 bg-premium-navy flex items-center justify-center text-white text-sm font-bold">
              Piitrade
            </div>
          </video>
        ) : (
          <div className="absolute inset-0 bg-premium-navy flex items-center justify-center text-white text-sm font-bold">
            Piitrade
          </div>
        )}
        {/* Overlay gradient for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-premium-navy/70 via-transparent to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3">
          <span className="text-white text-xl font-black tracking-tight leading-none drop-shadow-lg">LIVE</span>
          <span className="text-white text-xl font-black tracking-tight leading-none drop-shadow-lg">NOW</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex justify-center pb-2.5">
          <Link
            href="/listings"
            className="inline-block bg-white/90 backdrop-blur-sm text-premium-navy text-[10px] font-bold px-5 py-1.5 rounded hover:bg-white transition-colors uppercase tracking-wide shadow"
          >
            SHOP NOW ›
          </Link>
        </div>
      </div>
    </div>
  );
}


