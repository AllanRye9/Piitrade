import Link from 'next/link';
import { ListingCard } from '@/components/listings/ListingCard';
import { RowCarousel } from '@/components/ui/RowCarousel';
import type { Listing } from '@/lib/types';

export interface HomeCollection {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  source: { type: 'category'; slug: string } | { type: 'placement'; placement: string } | { type: 'listings'; ids: string[] };
  listings: Listing[];
}

/** "View all" target for a collection row. */
function viewAllHref(c: HomeCollection): string | null {
  if (c.source.type === 'category') return `/listings?category=${encodeURIComponent(c.source.slug)}`;
  if (c.source.type === 'placement') return `/listings?placement=${encodeURIComponent(c.source.placement)}`;
  return null;
}

/** An admin-made row of ads (Admin → Homepage Layout → Collections): same cards and arrows as the built-in rows. */
export default function HomeCustomCollection({ collection }: { collection: HomeCollection }) {
  if (collection.listings.length === 0) return null;
  const href = viewAllHref(collection);
  return (
    <section className="animate-fade-up" aria-label={collection.title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="inline-block h-6 w-1 shrink-0 rounded-full bg-premium-gold" />
            <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy"><span aria-hidden="true">{collection.icon}</span> {collection.title}</h2>
          </div>
          {collection.subtitle && <p className="mt-0.5 pl-3 text-xs text-gray-500">{collection.subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="interactive flex shrink-0 items-center gap-1 text-xs font-semibold text-premium-gold hover:text-premium-gold-dark">
            View all
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </Link>
        )}
      </div>
      <RowCarousel ariaLabel={collection.title}>
        {collection.listings.map((listing) => <ListingCard key={listing.id} listing={listing} compact />)}
      </RowCarousel>
    </section>
  );
}
