'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import { useNavCategoryCounts } from '@/hooks/useActiveSubcategoryCounts';
import { useTr } from '@/lib/i18n/useTr';
import { formatCount } from '@/lib/formatCount';
import { categoryHref, categoryListingsHref } from '@/lib/categoryLinks';
import { ListingGrid } from '@/components/listings/ListingGrid';
import { buildBreadcrumb, buildTileGroups, type PageCategory } from '@/components/categories/categoryPageModel';
import type { Listing } from '@/lib/types';

export interface CategoryPageData {
  category: PageCategory & { id: string; parentId?: string | null };
  parent: { id: string; name: string; slug: string; icon?: string | null; shortName?: string | null } | null;
  children: PageCategory[];
  siblings: PageCategory[];
}

const PAGE_SIZE = 24;

/**
 * Generic category / subcategory page. Everything comes from the API, so a category added or
 * renamed in Admin shows up here with no code change: header, breadcrumb, subcategory tiles grouped
 * by menuGroup (only those with listings), siblings, and the latest listings.
 */
export default function CategoryPageClient({ data }: { data: CategoryPageData }) {
  const tr = useTr();
  const { country } = useCountry();
  const { data: countData } = useNavCategoryCounts(country);
  const counts = countData?.counts ?? null;
  const { category, parent, children, siblings } = data;
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/listings', { params: { category: category.slug, limit: PAGE_SIZE, country } })
      .then(({ data: res }) => { if (!cancelled) setListings((res.listings as Listing[]) ?? []); })
      .catch(() => { if (!cancelled) setListings([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category.slug, country]);

  const groups = useMemo(() => buildTileGroups(children, counts, category.slug, category.icon), [children, counts, category.slug, category.icon]);
  const crumbs = useMemo(() => buildBreadcrumb(category, parent, categoryHref), [category, parent]);
  const liveSiblings = useMemo(
    () => siblings.filter((s) => !counts || (counts[s.slug] ?? 0) > 0),
    [siblings, counts],
  );
  const total = counts ? (counts[category.slug] ?? 0) : null;
  const icon = category.icon || parent?.icon || '📦';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, ...(c.href ? { item: c.href } : {}) })),
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-gray-500">
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">›</span>}
              {c.href ? <Link href={c.href} className="hover:text-red-600 hover:underline">{tr(c.label)}</Link> : <span aria-current="page" className="font-semibold text-gray-700">{category.name}</span>}
            </li>
          ))}
        </ol>
      </nav>

      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--theme-bg-light)] text-3xl" aria-hidden="true">{icon}</span>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">{category.name}</h1>
            {total != null && total > 0 && <p className="text-sm text-gray-500">{formatCount(total)} {tr(total === 1 ? 'listing' : 'listings')}</p>}
          </div>
        </div>
        <Link href={categoryListingsHref(category.slug)} className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:border-red-300 hover:text-red-700">
          {tr('Filter & sort')} →
        </Link>
      </header>

      {groups.length > 0 && (
        <section aria-label={tr('Subcategories')} className="mb-8 space-y-4">
          {groups.map((g) => (
            <div key={g.heading ?? 'all'}>
              {g.heading && <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-gray-500">{tr(g.heading)}</h2>}
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {g.tiles.map((t) => (
                  <li key={t.slug}>
                    <Link href={t.href} className="flex h-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:border-red-300 hover:text-red-700">
                      <span aria-hidden="true" className="text-lg">{t.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 leading-tight">{tr(t.label)}</span>
                        {t.count ? <span className="block text-[11px] tabular-nums text-gray-400">{formatCount(t.count)}</span> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {liveSiblings.length > 0 && (
        <section aria-label={tr('Related categories')} className="mb-6">
          <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-gray-500">{tr('More in')} {parent?.name}</h2>
          <ul className="flex flex-wrap gap-1.5">
            {liveSiblings.map((s) => (
              <li key={s.slug}>
                <Link href={`/category/${encodeURIComponent(s.slug)}`} className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700 hover:border-red-300 hover:bg-white hover:text-red-700">
                  {tr(s.shortName || s.name)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={tr('Latest listings')}>
        <h2 className="mb-3 text-lg font-bold text-gray-900">{tr('Latest in')} {category.name}</h2>
        {!loading && listings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-600">{tr('No listings here yet.')}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Link href="/listings/create" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">{tr('Post the first one')}</Link>
              <Link href="/profile/alerts" className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">🔔 {tr('Alert me when one is posted')}</Link>
            </div>
          </div>
        ) : (
          <>
            <ListingGrid listings={listings} loading={loading} />
            {listings.length >= PAGE_SIZE && (
              <div className="mt-5 text-center">
                <Link href={categoryListingsHref(category.slug)} className="inline-flex rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:border-red-300 hover:text-red-700">
                  {tr('See all')} {category.name} →
                </Link>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
