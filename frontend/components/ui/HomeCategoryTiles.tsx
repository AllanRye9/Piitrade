'use client';

import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { useCategoryCounts } from '@/hooks/useCategoryCounts';
import { useTr } from '@/lib/i18n/useTr';
import { HOME_CATEGORIES } from '@/lib/homeCategories';
import { isBuyerVisible } from '@/lib/categoryVisibility';
import { formatCount } from '@/lib/formatCount';
import CategoryCount from '@/components/ui/CategoryCount';
import { RowCarousel } from '@/components/ui/RowCarousel';

/**
 * "Browse by category" icon row for tablets and desktops (phones get
 * MobileCategoryGrid). Each tile shows how many listings the category holds,
 * so visitors can see at a glance where the activity is.
 */
export default function HomeCategoryTiles() {
  const tr = useTr();
  const { country } = useCountry();
  const { counts, total, loading } = useCategoryCounts(country);

  return (
    <section aria-labelledby="home-categories-heading" className="hidden px-1.5 pb-1 pt-2 sm:block">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="home-categories-heading" className="text-base font-bold text-gray-900 sm:text-lg">
          {tr('Browse by category')}
        </h2>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {total != null && total > 0 && (
            <span className="tabular-nums">{formatCount(total)} {tr('active listings')}</span>
          )}
          <Link href="/listings" className="font-semibold text-[var(--theme-primary-dark)] hover:underline">
            {tr('View all')}
          </Link>
        </div>
      </div>

      {/* One row at every size, with back/forward arrows (11 categories overflow on all but the widest screens). */}
      <RowCarousel
        ariaLabel={tr('Browse by category')}
        itemClassName="basis-[calc((100%-2rem)/5)] md:basis-[calc((100%-2.5rem)/6)] lg:basis-[calc((100%-3.5rem)/8)] xl:basis-[calc((100%-4.5rem)/10)]"
      >
        {HOME_CATEGORIES.filter((cat) => cat.alwaysShow || cat.countKey === null || isBuyerVisible(cat.countKey, counts)).map((cat) => (
            <Link
              key={cat.href}
              href={cat.href}
              className="group flex h-full flex-col items-center gap-1 rounded-2xl border border-gray-200 bg-white px-2 py-3 text-center transition-all hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--theme-bg-light)] text-2xl transition-transform group-hover:scale-105"
                aria-hidden="true"
              >
                {cat.icon}
              </span>
              <span className="text-[13px] font-semibold leading-tight text-gray-900">{tr(cat.shortLabel ?? cat.label)}</span>
              <span className="block min-h-[14px] text-[11px] leading-none text-gray-500">
                {cat.countKey ? (
                  <CategoryCount count={counts ? counts[cat.countKey] ?? 0 : null} loading={loading} />
                ) : (
                  cat.tagline && tr(cat.tagline)
                )}
              </span>
            </Link>
        ))}
      </RowCarousel>
    </section>
  );
}
