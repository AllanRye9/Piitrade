/**
 * CountryLatestCollections
 * Re-fetches Latest Collections listings when the selected country changes.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import { RowCarousel } from '@/components/ui/RowCarousel';
import type { Listing } from '@/lib/types';
import { API_URL } from '@/lib/api';


interface Props { initialListings: Listing[]; }

export default function CountryLatestCollections({ initialListings }: Props) {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>(initialListings);
  const skipFirst = useRef(true);

  useEffect(() => {
    // The server already rendered this row for Uganda (the only country); fetching it again on mount only
    // duplicates the request. Later country changes still refetch.
    if (skipFirst.current) { skipFirst.current = false; if (country === 'UGANDA' && initialListings.length > 0) return; }
    let cancelled = false;
    fetch(`${API_URL}/api/listings/latest-collections?limit=12&country=${country}`)
      .then((r) => r.ok ? r.json() : { listings: [] })
      .then((data) => { if (!cancelled) setListings(data.listings || []); })
      .catch(() => { if (!cancelled) setListings([]); });
    return () => { cancelled = true; };
    // Only a country change should refetch; the initial props are read once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  if (listings.length === 0) return null;

  // One row with back/forward arrows (compact cards), same as the other homepage sections.
  return (
    <RowCarousel ariaLabel="Latest collections">
      {listings.slice(0, 12).map((listing) => (
        <ListingCard key={listing.id} listing={listing} compact />
      ))}
    </RowCarousel>
  );
}
