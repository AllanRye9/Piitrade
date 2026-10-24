'use client';

import Link from 'next/link';
import { useSiteConfig, type Deal } from '@/context/SiteConfigContext';
import { useCountry } from '@/context/CountryContext';
import { formatCurrency, resolveImageUrl } from '@/lib/utils';
import { T } from '@/components/ui/T';
import { RowCarousel } from '@/components/ui/RowCarousel';

/**
 * TodaysDeals
 *
 * Homepage "Today's Deals" row, managed at Admin -> Settings -> Today's Deals
 * (stored in SiteConfig.todaysDeals, served by /api/public/site-config).
 * A deal shows when it has no country restriction (or lists the visitor's
 * country) and has not expired. Self-hides when nothing qualifies.
 */
function dealHref(deal: Deal): string {
  const link = (deal.link || '').trim();
  return link || '/listings';
}

function dealDiscount(deal: Deal): number | null {
  if (deal.discount && deal.discount > 0) return Math.round(deal.discount);
  if (deal.price != null && deal.originalPrice != null && deal.originalPrice > deal.price && deal.originalPrice > 0) {
    return Math.round(((deal.originalPrice - deal.price) / deal.originalPrice) * 100);
  }
  return null;
}

export default function TodaysDeals() {
  const { todaysDeals } = useSiteConfig();
  const { country } = useCountry();

  const now = Date.now();
  const deals = (todaysDeals || [])
    .filter((d) => {
      const countryMatch = !d.countries || d.countries.length === 0 || d.countries.includes(country);
      const notExpired = !d.expiresAt || new Date(d.expiresAt).getTime() > now;
      return countryMatch && notExpired && !!d.title;
    })
    .slice(0, 12);

  if (deals.length === 0) return null;

  return (
    <section aria-labelledby="todays-deals-heading" className="animate-fade-up rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50/70 to-orange-50/50 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 id="todays-deals-heading" className="text-base xs:text-lg sm:text-xl font-extrabold text-premium-navy flex items-center gap-1.5 min-w-0">
          <span aria-hidden="true">🔥</span>
          <span className="truncate"><T>Today&apos;s Deals</T></span>
        </h2>
        <Link
          href="/listings"
          className="shrink-0 text-xs font-semibold text-premium-gold hover:text-premium-gold-dark flex items-center gap-1 interactive"
        >
          <T>View all</T>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      <RowCarousel ariaLabel="Today's deals">
        {deals.map((deal) => {
          const pct = dealDiscount(deal);
          const external = /^https?:\/\//i.test(dealHref(deal));
          return (
            <Link
              key={deal.id}
              href={dealHref(deal)}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="group h-full bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
                {deal.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImageUrl(deal.imageUrl)}
                    alt={deal.title}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl text-gray-300" aria-hidden="true">🛍️</div>
                )}
                {pct !== null && (
                  <span className="absolute top-1.5 left-1.5 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-extrabold text-white shadow">
                    -{pct}%
                  </span>
                )}
              </div>
              <div className="p-1.5 xs:p-2 sm:p-3 flex flex-1 flex-col gap-0.5 min-w-0 min-h-[7.25rem] sm:min-h-[11rem] lg:min-h-[9.75rem]">
                <p className="text-[11px] xs:text-xs sm:text-sm font-semibold text-gray-900 line-clamp-2 leading-snug min-h-[2.5em]">{deal.title}</p>
                {deal.price != null && (
                  <p className="text-xs sm:text-sm font-extrabold text-[var(--theme-primary)]">{formatCurrency(deal.price)}</p>
                )}
                {deal.originalPrice != null && deal.price != null && deal.originalPrice > deal.price && (
                  <p className="text-[11px] text-gray-400 line-through">{formatCurrency(deal.originalPrice)}</p>
                )}
              </div>
            </Link>
          );
        })}
      </RowCarousel>
    </section>
  );
}
