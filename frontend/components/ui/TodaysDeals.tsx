'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSiteConfig, Deal } from '@/context/SiteConfigContext';
import { resolveImageUrl } from '@/lib/utils';
import { useCountry } from '@/context/CountryContext';

function DealCard({ deal }: { deal: Deal }) {
  const hasDiscount = deal.discount && deal.discount > 0;
  const hasPrices = deal.price !== undefined && deal.price !== null;

  // Resolve imageUrl through the same utility used by ListingCard — handles relative & cdn URLs
  const resolvedImage = deal.imageUrl ? resolveImageUrl(deal.imageUrl) : null;

  // Determine link: use deal.link if set, otherwise fall back to the listings page
  const dealHref = deal.link
    ? deal.link.startsWith('http')
      ? deal.link
      : deal.link
    : '/listings';

  const inner = (
    <div className="group bg-white rounded-2xl border border-amber-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col h-full">
      {resolvedImage && (
        <div className="relative w-full aspect-[4/3] bg-gray-50 overflow-hidden shrink-0">
          <Image
            src={resolvedImage}
            alt={deal.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 40vw, 25vw"
            onError={(e) => {
              const parent = (e.target as HTMLElement).closest('.relative');
              if (parent) (parent as HTMLElement).style.display = 'none';
            }}
          />
          {hasDiscount && (
            <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              -{deal.discount}%
            </span>
          )}
        </div>
      )}

      <div className="p-3 flex flex-col gap-1 flex-1">
        <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{deal.title}</p>
        {deal.description && (
          <p className="text-gray-500 text-xs line-clamp-2">{deal.description}</p>
        )}
        {hasPrices && (
          <div className="flex items-baseline gap-2 mt-auto pt-1">
            <span className="text-amber-600 font-bold text-base">
              {deal.price} {deal.currency || 'AED'}
            </span>
            {deal.originalPrice !== undefined && deal.originalPrice > (deal.price ?? 0) && (
              <span className="text-gray-400 line-through text-xs">
                {deal.originalPrice} {deal.currency || 'AED'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (dealHref.startsWith('http')) {
    return (
      <a href={dealHref} target="_blank" rel="noopener noreferrer" className="block h-full">
        {inner}
      </a>
    );
  }
  return <Link href={dealHref} className="block h-full">{inner}</Link>;
}

export default function TodaysDeals() {
  const { todaysDeals } = useSiteConfig();
  const { country } = useCountry();

  if (!todaysDeals || todaysDeals.length === 0) return null;

  // Filter deals to those visible for the selected country. Previously this
  // filtered by currency (`d.currency === displayCurrency`), but every deal
  // defaults to currency 'AED' when created — so any deal added without the
  // admin manually changing its currency dropdown was silently invisible to
  // Uganda/Kenya/China visitors (3 of 4 countries), while still appearing to
  // save correctly in the admin panel. Visibility is now controlled by an
  // explicit `countries` list (empty/undefined = visible everywhere),
  // decoupled from `currency`, which is used only for price display.
  const countryDeals = todaysDeals.filter(
    (d) => !d.countries || d.countries.length === 0 || d.countries.includes(country)
  );

  if (countryDeals.length === 0) return null;

  return (
    <section className="animate-fade-up">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-1 h-6 bg-amber-500 rounded-full inline-block" />
            <h2 className="text-lg xs:text-xl font-extrabold text-elite-navy">Today&apos;s Deals</h2>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 pl-3">
            Handpicked offers in {country === 'UAE' ? 'UAE (AED)' : country === 'UGANDA' ? 'Uganda (UGX)' : country === 'KENYA' ? 'Kenya (KES)' : 'China (CNY)'}
          </p>
        </div>
        <Link href="/listings" className="text-xs font-semibold text-amber-600 hover:text-amber-700 flex items-center gap-1">
          View all
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {countryDeals.slice(0, 6).map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
      </div>
    </section>
  );
}

