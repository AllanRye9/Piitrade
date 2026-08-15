'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface SiteStats {
  activeListings: number;
  totalUsers: number;
  totalListings: number;
  countries: number;
  pageViews: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M+`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K+`;
  return n.toLocaleString('en-US');
}

const STAT_CARDS = [
  { key: 'pageViews' as const, icon: '📈', label: 'Page Views', fallback: '500K+' },
  { key: 'activeListings' as const, icon: '📋', label: 'Active Listings', fallback: '50K+' },
  { key: 'countries' as const, icon: '🌍', label: 'Countries', fallback: '4' },
];

export default function AdvertisingPage() {
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    api.get('/stats')
      .then((response) => setStats(response.data))
      .catch(() => { });
  }, []);

  return (
    <div className="bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.08),_transparent_38%),linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)]">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="rounded-[2rem] border border-sky-100 bg-white/90 p-5 shadow-[0_25px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-7">
          <span className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
            Advertising
          </span>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-premium-navy sm:text-5xl">
            Promote products to active local shoppers
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
            Advertising on Piitrade is aimed at merchants and brands that want direct visibility inside a marketplace already built around buyer intent.
          </p>

          {/* Site Traffic Stats */}
          <div className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-xl">
              📈 Site Traffic Stats
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STAT_CARDS.map(({ key, icon, label, fallback }) => (
                <div
                  key={label}
                  className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4 text-center shadow-sm"
                >
                  <div className="text-2xl mb-1">{icon}</div>
                  <div className="text-2xl font-extrabold text-premium-navy">
                    {stats ? (key === 'countries' ? String(stats[key]) : fmt(stats[key])) : fallback}
                  </div>
                  <div className="text-xs font-medium text-slate-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-6">
              <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Who this is for</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600 sm:text-base">
                <p>Retailers, service providers, distributors, and local businesses can use placements to reach users already browsing by category, location, and product intent.</p>
              </div>
            </section>
            <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-6">
              <h2 className="text-lg font-bold text-slate-900 sm:text-xl">How to get started</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600 sm:text-base">
                <p>Send your campaign goals, target market, and preferred timing to support@piitrade.com. Include whether you want visibility in UAE, Uganda, or both.</p>
                <p>We will use that information to recommend placement options and rollout timing.</p>
              </div>
            </section>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="mailto:support@piitrade.com"
              className="inline-flex items-center justify-center rounded-xl bg-premium-navy px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
            >
              Contact advertising
            </a>
            <Link
              href="/listings"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Browse listings
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}