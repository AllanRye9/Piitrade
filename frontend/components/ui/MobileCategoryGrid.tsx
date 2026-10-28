'use client';

import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { useCategoryCounts } from '@/hooks/useCategoryCounts';
import { useTr } from '@/lib/i18n/useTr';
import { HOME_CATEGORIES } from '@/lib/homeCategories';
import { buildHomeTiles } from '@/lib/homeTiles';
import { useCategoryTree } from '@/hooks/useCategoryTree';
import { useCategoryLayout } from '@/hooks/useCategoryLayout';
import CategoryCount from '@/components/ui/CategoryCount';

// Mirrors the icon-tile category grid from the reference mobile layout:
// a cream rounded-square icon tile with a label underneath, four per row.
// Reuses the same top-level categories/hrefs as CategoryBar so tapping a
// tile lands on the same destination as the desktop mega-menu tab.
// Tiles come from the shared home category list (also used by the desktop row), ordered by the
// admin's category layout (default Uganda rank otherwise). The grid is 4x2: the top 7 categories
// plus a "More" tile that opens /categories, so every other category stays one tap away.
const MOBILE_TILE_SLOTS = 7;

export default function MobileCategoryGrid() {
  const tr = useTr();
  const { country } = useCountry();
  const { counts, loading } = useCategoryCounts(country);
  const { tree } = useCategoryTree();
  const { rank, hidden } = useCategoryLayout();
  const tiles = buildHomeTiles({ base: HOME_CATEGORIES, tree, counts, configRank: rank, hidden }).slice(0, MOBILE_TILE_SLOTS);
  return (
    <section aria-label="Browse by category" className="sm:hidden px-3 pt-4 pb-1 bg-white relative z-10 rounded-t-2xl">
      <div className="grid grid-cols-4 gap-x-2 gap-y-3">
        {tiles.map((cat) => (
          <Link
            key={cat.href}
            href={cat.href}
            className="flex flex-col items-center gap-1.5 interactive group"
          >
            <div className="relative w-full aspect-square max-w-[72px] mx-auto rounded-2xl bg-[var(--theme-bg-light)] flex items-center justify-center text-2xl xs:text-3xl shadow-sm group-active:scale-95 transition-transform">
              {cat.badge && (
                <span className="absolute -top-1.5 -right-1 bg-gray-900 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap">
                  {cat.badge}
                </span>
              )}
              <span aria-hidden="true">{cat.icon}</span>
            </div>
            <span className="line-clamp-2 text-[11px] font-semibold text-gray-700 text-center leading-tight">{tr(cat.shortLabel ?? cat.label)}</span>
            <span className="-mt-1 block min-h-[12px] text-center text-[10px] leading-tight text-gray-500">
              <CategoryCount count={cat.countKey && counts ? counts[cat.countKey] ?? 0 : null} loading={loading && !!cat.countKey} />
            </span>
          </Link>
        ))}
        <Link href="/categories" className="flex flex-col items-center gap-1.5 interactive group" aria-label={tr('More categories')}>
          <div className="relative w-full aspect-square max-w-[72px] mx-auto rounded-2xl bg-gray-100 flex items-center justify-center text-2xl xs:text-3xl shadow-sm group-active:scale-95 transition-transform">
            <span aria-hidden="true">⋯</span>
          </div>
          <span className="text-[11px] font-semibold text-gray-700 text-center leading-tight">{tr('More')}</span>
          <span className="-mt-1 block min-h-[12px] text-center text-[10px] leading-tight text-gray-500">{tr('All categories')}</span>
        </Link>
      </div>
    </section>
  );
}
