/**
 * CountryRecentAcrossCategories
 *
 * Re-fetches Motors, Electronics, Property and Fashion listings every time
 * the selected country changes so only that country's items are shown.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import type { Listing } from '@/lib/types';
import { api } from '@/lib/api';

type CategoryKey = 'motors' | 'electronics' | 'property' | 'fashion';

const CATEGORIES: { key: CategoryKey; label: string; href: string; icon: string }[] = [
  { key: 'motors',      label: 'Motors',      href: '/motors',      icon: '🚗' },
  { key: 'electronics', label: 'Electronics', href: '/electronics', icon: '💻' },
  { key: 'property',    label: 'Property',    href: '/property',    icon: '🏠' },
  { key: 'fashion',     label: 'Fashion',     href: '/fashion',     icon: '👗' },
];

interface Props {
  initialMotors:      Listing[];
  initialElectronics: Listing[];
  initialProperty:    Listing[];
  initialFashion:     Listing[];
}

async function fetchCategory(category: string, country: string): Promise<Listing[]> {
  try {
    const { data } = await api.get(`/listings?category=${category}&country=${country}&limit=6&sort=createdAt`);
    return data.listings || [];
  } catch {
    return [];
  }
}

export default function CountryRecentAcrossCategories({
  initialMotors, initialElectronics, initialProperty, initialFashion,
}: Props) {
  const { country } = useCountry();
  const [byCategory, setByCategory] = useState<Record<CategoryKey, Listing[]>>({
    motors: initialMotors,
    electronics: initialElectronics,
    property: initialProperty,
    fashion: initialFashion,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      CATEGORIES.map((cat) =>
        fetchCategory(cat.key, country).then((listings) => ({ key: cat.key, listings }))
      )
    ).then((results) => {
      if (cancelled) return;
      const next = {} as Record<CategoryKey, Listing[]>;
      results.forEach(({ key, listings }) => { next[key as CategoryKey] = listings; });
      setByCategory(next);
    });
    return () => { cancelled = true; };
  }, [country]);

  const active = CATEGORIES.filter((c) => (byCategory[c.key] || []).length > 0);
  if (active.length === 0) return null;

  return (
    <div className="space-y-5">
      {active.map((cat) => (
        <div key={cat.key}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <span>{cat.icon}</span> Latest {cat.label}
            </h3>
            <Link href={`${cat.href}?country=${country}`} className="text-xs text-red-600 hover:text-red-700 font-semibold">
              See more →
            </Link>
          </div>
          {/* Standard responsive grid — 2/row on phones, up to 6/row on
              desktop. Was a 3-per-row carousel on mobile; same readability
              fix as Flash Deals, Latest Collections, and Featured Deal. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {(byCategory[cat.key] || []).slice(0, 6).map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
