'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import type { Country } from '@/lib/types';

/* ─── Types ────────────────────────────────────────────────────────────────── */

interface Stats {
  totalVisitors: number;
  dailyVisitors: number;
  totalCountries: number;
}

const COUNTRY_TO_ISO: Record<Country, string> = {
  UGANDA: 'UG',
};

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

/* ─── Animated count-up hook ───────────────────────────────────────────────── */

function useCountUp(target: number, duration = 1400): number {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(ease * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return count;
}

/* ─── StatCard ─────────────────────────────────────────────────────────────── */

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const animated = useCountUp(visible ? value : 0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`flex flex-col items-center justify-center px-1 py-1.5 rounded-lg bg-white border border-gray-100 shadow-sm text-center transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <p className={`text-xs font-extrabold tabular-nums ${accent}`}>{formatNumber(animated)}</p>
      <p className="text-[7px] font-semibold text-gray-400 mt-px uppercase tracking-wide leading-tight">{label}</p>
    </div>
  );
}

/* ─── Main SiteAnalytics component ─────────────────────────────────────────── */

/**
 * SiteAnalytics
 *
 * Renders the stat-cards row (Total Visitors / Today's Visitors /
 * Countries) directly below the hero slideshow. This used to also render a
 * commodity-price widget next to the stat cards, duplicating the full
 * "UGANDA MARKET PRICES" section that appeared further down the page — that
 * compact widget has been removed and the full <HomeMarketPrices /> section
 * now renders once, directly below this row, instead. The stat cards
 * themselves are unchanged from before, just widened to fill the row on
 * their own.
 */
export default function SiteAnalytics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const { country } = useCountry();

  useEffect(() => {
    const isoCountry = COUNTRY_TO_ISO[country];
    api.get('/stats/public', { params: isoCountry ? { country: isoCountry } : undefined })
      .then(({ data }) => { if (data) setStats(data); })
      .catch(() => {});
  }, [country]);

  return (
    <section className="mt-1 px-1 animate-fade-up" aria-label="Site statistics">
      {/* ── Stat cards — full-width row now that the market-price widget
           that used to sit beside it has moved into its own section
           (see <HomeMarketPrices /> in app/page.tsx). ── */}
      <div className="grid grid-cols-3 gap-1.5">
        {stats ? (
          <>
            <StatCard label="Total Visitors"   value={stats.totalVisitors}  accent="text-red-600" />
            <StatCard label="Today's Visitors" value={stats.dailyVisitors}  accent="text-emerald-600" />
            <StatCard label="Countries"        value={stats.totalCountries} accent="text-violet-600" />
          </>
        ) : (
          ['Total Visitors', "Today's Visitors", 'Countries'].map((label) => (
            <div key={label} className="flex flex-col items-center justify-center px-1 py-1.5 rounded-lg bg-white border border-gray-100 shadow-sm text-center">
              <div className="h-3 w-8 bg-gray-100 rounded animate-pulse mb-px" />
              <p className="text-[7px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
