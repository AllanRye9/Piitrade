'use client';

import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { getLocations } from '@/lib/utils';
import type { Country } from '@/lib/types';

const COUNTRY_META: Record<Country, { isoCode: string; label: string; citiesToShow: number }> = {
  UAE:    { isoCode: 'AE', label: 'UAE',    citiesToShow: 2 },
  UGANDA: { isoCode: 'UG', label: 'Uganda', citiesToShow: 2 },
  KENYA:  { isoCode: 'KE', label: 'Kenya',  citiesToShow: 2 },
  CHINA:  { isoCode: 'CN', label: 'China',  citiesToShow: 2 },
};

/**
 * Footer's "Our Locations" list. Only shows countries the admin has enabled
 * (SiteConfig.enabledCountries, via CountryContext) instead of hardcoding
 * UAE/Uganda, so Kenya/China appear automatically once turned on. Renders
 * a flat <li> list — one per country plus one per featured city — to match
 * the original markup's visual structure (no nested indentation).
 */
export default function FooterLocations() {
  const { enabledCountries } = useCountry();

  return (
    <ul className="space-y-1.5 text-sm">
      {enabledCountries.flatMap((country) => {
        const meta = COUNTRY_META[country];
        const cities = getLocations(country).slice(0, meta.citiesToShow);
        return [
          <li key={country}>
            <Link
              href={`/listings?country=${country}`}
              className="text-gray-300 hover:text-sky-200 transition-colors flex items-center gap-1.5"
            >
              <FlagIcon code={meta.isoCode} size={14} /> {meta.label}
            </Link>
          </li>,
          ...cities.map((city) => (
            <li key={`${country}-${city}`}>
              <Link
                href={`/listings?country=${country}&location=${encodeURIComponent(city)}`}
                className="text-gray-300 hover:text-sky-200 transition-colors"
              >
                {city}
              </Link>
            </li>
          )),
        ];
      })}
    </ul>
  );
}
