'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';
import type { Listing } from '@/lib/types';
import OtherCollectionsGrid from '@/components/ui/OtherCollectionsGrid';

interface Props {
  /** Server-fetched listings used as the initial render before the client-side country filter is applied. */
  fallbackListings: Listing[];
}

/**
 * Client component that re-fetches the "Other Collections" listings
 * filtered by the user's selected (or auto-detected) country.
 */
export default function HomeOtherCollections({ fallbackListings }: Props) {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>(fallbackListings);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const skipFirst = useRef(true);

  useEffect(() => {
    // The server already rendered this row for Uganda (the only country); fetching it again on mount only
    // duplicates the request. Later country changes still refetch.
    if (skipFirst.current) { skipFirst.current = false; if (country === 'UGANDA' && fallbackListings.length > 0) return; }
    const controller = new AbortController();

    setLoading(true);
    setFetchError(false);
    // Clear immediately so stale listings from a different country never flash
    setListings([]);

    const params = new URLSearchParams({ limit: '24', sort: 'createdAt', country });
    api
      .get(`/listings?${params.toString()}`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const pool: Listing[] = data.listings || [];
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        setListings(pool);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setFetchError(true);
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('HomeOtherCollections: failed to fetch listings', err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => { controller.abort(); };
    // Only a country change should refetch; the initial props are read once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  if (loading && listings.length === 0) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-7 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl bg-gray-200 aspect-[3/4]" />
        ))}
      </div>
    );
  }

  if (fetchError && listings.length === 0) return null;

  return <OtherCollectionsGrid listings={listings} />;
}
