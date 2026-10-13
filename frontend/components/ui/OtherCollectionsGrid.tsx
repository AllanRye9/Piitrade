'use client';

import { useEffect, useRef, useState } from 'react';
import { ListingCard } from '@/components/listings/ListingCard';
import type { Listing } from '@/lib/types';

interface Props {
  listings: Listing[];
}

/**
 * Renders a grid of listings that always fills exactly 4 rows.
 * Column count is derived from the current breakpoint:
 *   < 640px  → 2 cols → 8 items
 *   ≥ 640px  → 3 cols → 12 items
 *   ≥ 768px  → 4 cols → 16 items
 *   ≥ 1024px → 6 cols → 24 items
 */
export default function OtherCollectionsGrid({ listings }: Props) {
  const [itemCount, setItemCount] = useState(24);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ROWS = 4;
    const update = () => {
      const w = window.innerWidth;
      let cols: number;
      if (w >= 1024) cols = 6;
      else if (w >= 768) cols = 4;
      else if (w >= 640) cols = 3;
      else cols = 2;
      setItemCount(cols * ROWS);
    };
    const handleResize = () => {
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(update, 150);
    };
    update();
    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      window.removeEventListener('resize', handleResize);
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const visible = listings.slice(0, itemCount);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-7 gap-3 stagger-children">
      {visible.map((listing) => (
        <ListingCard key={listing.id} listing={listing} cleanImage />
      ))}
    </div>
  );
}