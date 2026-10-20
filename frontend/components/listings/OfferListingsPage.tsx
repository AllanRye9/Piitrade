'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ListingGrid } from '@/components/listings/ListingGrid';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import OfferCountdown from '@/components/ui/OfferCountdown';
import { useCountry } from '@/context/CountryContext';
import type { Listing } from '@/lib/types';
import { T } from '@/components/ui/T';
import { useTr } from '@/lib/i18n/useTr';

type Kind = 'special-offers' | 'back-to-school';

const COPY: Record<Kind, { title: string; icon: string; blurb: (min: number | null) => string; gradient: string; sorts: { value: string; label: string }[] }> = {
  'special-offers': {
    title: 'Special Offers',
    icon: '🏷️',
    blurb: (min) => `Listings marked down ${min ?? 30}% or more — biggest discounts first.`,
    gradient: 'linear-gradient(135deg,#dc2626 0%,#ea580c 55%,#f59e0b 100%)',
    sorts: [
      { value: 'discount', label: 'Biggest discount' },
      { value: 'newest', label: 'Newest' },
      { value: 'price_asc', label: 'Price: low to high' },
      { value: 'price_desc', label: 'Price: high to low' },
    ],
  },
  'back-to-school': {
    title: 'Back to School',
    icon: '🎒',
    blurb: () => 'Uniforms, books, stationery, electronics and more — hand-picked for the new term.',
    gradient: 'linear-gradient(135deg,#1d4ed8 0%,#4f46e5 55%,#7c3aed 100%)',
    sorts: [
      { value: 'newest', label: 'Newest' },
      { value: 'price_asc', label: 'Price: low to high' },
      { value: 'price_desc', label: 'Price: high to low' },
    ],
  },
};

const PAGE_SIZE = 24;

export default function OfferListingsPage({ kind }: { kind: Kind }) {
  const tr = useTr();
  const copy = COPY[kind];
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(true);
  const [minDiscount, setMinDiscount] = useState<number | null>(null);
  const [endAt, setEndAt] = useState<string | null>(null);
  const [sort, setSort] = useState(copy.sorts[0].value);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    api
      .get(`/listings/${kind}`, {
        params: { country, limit: PAGE_SIZE, page, sort, ...(query ? { q: query } : {}) },
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setListings((data.listings || []) as Listing[]);
        setPages(data.pages || 0);
        setTotal(data.total || 0);
        setActive(data.active !== false);
        setMinDiscount(typeof data.minDiscountPercent === 'number' ? data.minDiscountPercent : null);
        setEndAt(data.endAt || null);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setListings([]);
        setLoading(false);
      });
    return () => controller.abort();
  }, [kind, country, page, sort, query]);

  useEffect(() => load(), [load]);

  return (
    <div className="min-h-screen bg-gray-50/90">
      <div className="relative overflow-hidden py-5 text-white sm:py-12" style={{ background: copy.gradient }}>
        <div className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative mx-auto max-w-7xl px-4">
          <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: copy.title }]} className="mb-4 text-white/70" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl sm:text-4xl drop-shadow-lg" aria-hidden="true">{copy.icon}</span>
              <div>
                <h1 className="text-lg font-black leading-tight sm:text-3xl">{copy.title}</h1>
                <p className="mt-0.5 text-xs sm:text-sm text-white/85">{copy.blurb(minDiscount)}</p>
              </div>
            </div>
            <OfferCountdown endAt={endAt} className="self-start sm:self-auto" />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-5">
        {!active && !loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
            <p className="text-lg font-bold text-gray-800">{copy.title} isn&apos;t running right now</p>
            <p className="mt-1 text-sm text-gray-500"><T>Check back soon, or browse everything on Piitrade.</T></p>
            <Link href="/listings" className="mt-4 inline-block rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
              <T>Browse all listings</T>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${copy.title.toLowerCase()}…`}
                aria-label={`Search ${copy.title}`}
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 sm:max-w-xs"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{loading ? 'Loading…' : `${total.toLocaleString('en-UG')} item${total === 1 ? '' : 's'}`}</span>
                <select
                  value={sort}
                  onChange={(e) => { setSort(e.target.value); setPage(1); }}
                  aria-label={tr("Sort")}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  {copy.sorts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <ListingGrid listings={listings} loading={loading} />

            {pages > 1 && (
              <nav className="mt-6 flex items-center justify-center gap-3" aria-label={tr("Pagination")}>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  <T>Previous</T>
                </button>
                <span className="text-sm text-gray-600">Page {page} of {pages}</span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => { setPage((p) => Math.min(pages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  <T>Next</T>
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
