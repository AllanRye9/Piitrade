'use client';

/**
 * HeaderStats
 *
 * Compact "Total Visitors / Today's Visitors / Countries" readout that sits
 * directly in the header row, between the search bar and the Home icon.
 * Previously these three numbers lived in their own animated stat-card row
 * below the homepage slideshow (see git history / SiteAnalytics.tsx) — they
 * now live once, globally, in the header on every page instead.
 *
 * Pulls from the same GET /api/stats/public endpoint the old homepage
 * widget used. Hidden below the `lg` breakpoint where there simply isn't
 * room for it alongside the search bar and nav icons.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import type { Country } from '@/lib/types';

interface Stats {
  totalVisitors: number;
  dailyVisitors: number;
  totalCountries: number;
}

const COUNTRY_TO_ISO: Record<Country, string> = {
  UGANDA: 'UG',
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

interface Props {
  /** Header is on a solid orange gradient when unscrolled, and a white/
   *  translucent bar once scrolled — stat pills need different contrast
   *  treatment for each. */
  scrolled: boolean;
}

export default function HeaderStats({ scrolled }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const { country } = useCountry();

  useEffect(() => {
    const isoCountry = COUNTRY_TO_ISO[country];
    api.get('/stats/public', { params: isoCountry ? { country: isoCountry } : undefined })
      .then(({ data }) => { if (data) setStats(data); })
      .catch(() => {});
  }, [country]);

  if (!stats) return null;

  const items: { label: string; value: number; icon: string }[] = [
    { label: 'Total Visitors', value: stats.totalVisitors, icon: '👥' },
    { label: "Today's Visitors", value: stats.dailyVisitors, icon: '📅' },
    { label: 'Countries', value: stats.totalCountries, icon: '🌍' },
  ];

  return (
    <div
      className={`hidden lg:flex items-center gap-2.5 shrink-0 px-3 py-1.5 rounded-xl border transition-colors ${
        scrolled
          ? 'bg-[var(--theme-bg-light)]/70 border-gray-200'
          : 'bg-white/10 border-white/25 backdrop-blur-sm'
      }`}
      aria-label="Site statistics"
    >
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-2.5">
          {i > 0 && (
            <span className={`w-px h-6 ${scrolled ? 'bg-gray-300/70' : 'bg-white/25'}`} aria-hidden="true" />
          )}
          <div className="flex items-center gap-1.5" title={item.label}>
            <span className="text-xs leading-none" aria-hidden="true">{item.icon}</span>
            <div className="leading-none">
              <p className={`text-xs font-extrabold tabular-nums ${scrolled ? 'text-premium-navy' : 'text-white'}`}>
                {formatNumber(item.value)}
              </p>
              <p className={`text-[8px] font-semibold uppercase tracking-wide ${scrolled ? 'text-gray-500' : 'text-white/70'}`}>
                {item.label}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
