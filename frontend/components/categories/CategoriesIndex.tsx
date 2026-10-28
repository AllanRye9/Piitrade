'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { useNavCategoryCounts } from '@/hooks/useActiveSubcategoryCounts';
import { useCategoryTree } from '@/hooks/useCategoryTree';
import { useCategoryLayout } from '@/hooks/useCategoryLayout';
import { useTr } from '@/lib/i18n/useTr';
import { formatCount } from '@/lib/formatCount';
import { buildIndexCards } from '@/components/categories/categoryIndexModel';

/**
 * /categories — the home of the long tail. Every top-level category that currently has listings,
 * in the admin's order, each with its most-populated subcategories as chips. Categories with no
 * listings never appear here (sellers still see them in the post form).
 */
export default function CategoriesIndex() {
  const tr = useTr();
  const { country } = useCountry();
  const { data, loading } = useNavCategoryCounts(country);
  const { tree } = useCategoryTree();
  const { rank, hidden } = useCategoryLayout();
  const [query, setQuery] = useState('');

  const counts = data?.counts ?? null;
  const ready = tree !== null && !(loading && !counts);

  const cards = useMemo(
    () => buildIndexCards({ tree, counts, configRank: rank, hidden, query }),
    [tree, counts, rank, hidden, query],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">{tr('All categories')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {tr('Browse everything on Piitrade, from cars and property to market stalls, services and farm produce.')}
          </p>
        </div>
        <div className="w-full sm:w-80">
          <label htmlFor="category-search" className="sr-only">{tr('Find a category')}</label>
          <input
            id="category-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Find a category (e.g. boda boda, salon, cement)')}
            className="input-premium w-full text-sm"
            autoComplete="off"
          />
        </div>
      </header>

      {!ready && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label={tr('Loading categories')}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />
          ))}
        </div>
      )}

      {ready && tree && tree.length === 0 && (
        <p className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600">
          {tr('Categories are unavailable right now.')}{' '}
          <Link href="/listings" className="font-semibold text-[var(--theme-primary-dark)] hover:underline">{tr('Browse all listings')} →</Link>
        </p>
      )}

      {ready && tree && tree.length > 0 && cards.length === 0 && (
        <p className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-600" role="status">
          {query
            ? <>{tr('No categories match')} “{query}”. </>
            : <>{tr('No categories have listings yet.')} </>}
          <Link href="/listings" className="font-semibold text-[var(--theme-primary-dark)] hover:underline">{tr('Browse all listings')} →</Link>
        </p>
      )}

      {ready && cards.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((card) => (
            <li key={card.slug} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
              <Link href={card.href} className="group flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--theme-bg-light)] text-2xl" aria-hidden="true">{card.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-bold text-gray-900 group-hover:text-[var(--theme-primary-dark)]">{tr(card.name)}</span>
                  {card.count != null && card.count > 0 && (
                    <span className="block text-xs tabular-nums text-gray-500">{formatCount(card.count)} {tr(card.count === 1 ? 'listing' : 'listings')}</span>
                  )}
                </span>
              </Link>

              {card.chips.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`${card.name} ${tr('subcategories')}`}>
                  {card.chips.map((chip) => (
                    <li key={chip.slug} className="max-w-full">
                      <Link
                        href={chip.href}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-red-300 hover:bg-white hover:text-red-700"
                      >
                        <span className="truncate">{tr(chip.name)}</span>
                        <span className="tabular-nums text-gray-400">{formatCount(chip.count)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <Link href={card.href} className="mt-auto pt-3 text-xs font-semibold text-[var(--theme-primary-dark)] hover:underline">
                {card.hiddenChips > 0 ? `${tr('See all')} (+${card.hiddenChips})` : tr('See all')} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
