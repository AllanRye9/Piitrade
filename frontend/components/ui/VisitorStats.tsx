'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import type { Country } from '@/lib/types';

/**
 * VisitorStats
 *
 * Small "Total Visitors" / "Today's Visitors" readout that lives in the
 * site footer, so — unlike the compact stat pills in the header (see
 * <HeaderStats /> in components/layout/HeaderStats.tsx) — it shows up on
 * every public page via <Footer /> even below the header's `lg` breakpoint.
 *
 * Pulls from the same GET /api/stats/public endpoint HeaderStats uses;
 * `totalVisitors` never resets, `dailyVisitors` resets at local midnight
 * for the visitor's selected/detected country.
 */

interface PublicStats {
  totalVisitors: number;
  dailyVisitors: number;
}

const COUNTRY_TO_ISO: Record<Country, string> = {
  UGANDA: 'UG',
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

export default function VisitorStats({ className = '' }: { className?: string }) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const { country } = useCountry();

  useEffect(() => {
    const isoCountry = COUNTRY_TO_ISO[country];
    api.get('/stats/public', { params: isoCountry ? { country: isoCountry } : undefined })
      .then(({ data }) => { if (data) setStats(data); })
      .catch(() => {});
  }, [country]);

  if (!stats) return null;

  return (
    <div className={`flex items-center gap-3 text-xs text-gray-300 ${className}`}>
      <span className="flex items-center gap-1">
        <span className="font-bold text-white tabular-nums">{formatNumber(stats.totalVisitors)}</span>
        Total Visitors
      </span>
      <span className="w-px h-3 bg-white/15" aria-hidden="true" />
      <span className="flex items-center gap-1">
        <span className="font-bold text-white tabular-nums">{formatNumber(stats.dailyVisitors)}</span>
        Daily Visitors
      </span>
    </div>
  );
}
