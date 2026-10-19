import { SkeletonCard } from '@/components/listings/ListingGrid';

/** Placeholder for a page that is loading a header block plus a grid of listing cards (no spinner). */
export function GridPageSkeleton({ cards = 10, banner = true }: { cards?: number; banner?: boolean }) {
  return (
    <div className="mx-auto max-w-7xl px-3 py-4" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {banner && (
        <div className="mb-4 flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-xl bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: cards }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}

/** Placeholder for a list of rows (jobs, saved searches, notifications...). */
export function ListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-4xl space-y-3 px-3 py-4" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
