'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Stats {
  activeListings: number;
  totalUsers: number;
  totalListings: number;
  countries: number;
  pageViews: number;
}

function fmtStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

const FALLBACK_ITEMS = [
  { icon: '👥', label: 'Total Visitors', value: '20K+' },
  { icon: '👁️', label: 'Page Views', value: '500K+' },
  { icon: '🌍', label: 'Countries', value: '4' },
];

export default function StatsTicker() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.get('/stats')
      .then((response) => setStats(response.data ?? null))
      .catch(() => { });
  }, []);

  const items = stats
    ? [
      { icon: '👥', label: 'Total Visitors', value: fmtStat(stats.totalUsers) },
      { icon: '👁️', label: 'Page Views', value: fmtStat(stats.pageViews ?? 0) },
      { icon: '🌍', label: 'Countries', value: String(stats.countries) },
    ]
    : FALLBACK_ITEMS;

  const tickerItems = [...items, ...items];

  return (
    <div className="overflow-hidden bg-[#0B132B]/90 border-b border-white/10 py-1">
      <div
        className="flex whitespace-nowrap animate-ticker"
        style={{ width: 'fit-content' }}
        aria-label="Live platform statistics"
      >
        {tickerItems.map((item, i) => (
          <span
            key={`${i < items.length ? 'a' : 'b'}-${i % items.length}`}
            className="inline-flex items-center gap-1.5 px-5 text-[11px] font-semibold text-white/90"
          >
            <span aria-hidden="true">{item.icon}</span>
            <span className="text-white/60">{item.label}:</span>
            <span className="text-sky-300 font-bold">{item.value}</span>
            <span className="text-white/30 ml-3">|</span>
          </span>
        ))}
      </div>
    </div>
  );
}
