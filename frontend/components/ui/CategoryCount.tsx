'use client';

import { formatCount } from '@/lib/formatCount';
import { useTr } from '@/lib/i18n/useTr';

interface CategoryCountProps {
  /** null/undefined = unknown (failed, or no count for this category). */
  count: number | null | undefined;
  loading?: boolean;
  /** Append "listings" (tiles) or show the bare number (sidebar). */
  withUnit?: boolean;
}

/** Item count under/next to a category icon, with skeleton and empty states. */
export default function CategoryCount({ count, loading = false, withUnit = true }: CategoryCountProps) {
  const tr = useTr();
  if (loading) {
    return <span className="inline-block h-2.5 w-10 animate-pulse rounded bg-gray-200 align-middle" aria-hidden="true" />;
  }
  if (count == null) return null;
  if (count <= 0) {
    return withUnit ? <span className="text-gray-400">{tr('No listings yet')}</span> : null;
  }
  return (
    <span className="tabular-nums">
      {formatCount(count)}
      {withUnit && <> {tr(count === 1 ? 'listing' : 'listings')}</>}
    </span>
  );
}
