import Link from 'next/link';
import Image from 'next/image';
import { resolveImageUrl } from '@/lib/utils';

// Reference mobile layout has a "Big brands near you" section directly under
// the flash-sale banner: a 2-up grid of compact horizontal cards (logo +
// name + a trust/eta subtext) linking out to each brand's storefront.
// Piitrade already has the backing feature (Store model, partner program,
// GET /api/stores) and a /stores nav link, but no homepage row surfacing it —
// this fills that gap using the same card conventions as app/stores/page.tsx
// (partnerLogoUrl || logo, initials-avatar fallback) so a store looks the
// same wherever it appears in the app.

export interface FeaturedStore {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  partnerLogoUrl?: string | null;
  partnerName?: string | null;
  partnerApproved?: boolean;
  /** Active store-plan tier (set by the API); Gold/Platinum stores get a badge and rank first. */
  tier?: 'FREE' | 'GOLD' | 'PLATINUM';
  user: {
    companyName: string | null;
    country: string;
  };
}

const COUNTRY_LABELS: Record<string, string> = { UGANDA: 'Uganda' };

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : (parts[0][0] + parts[1][0]).toUpperCase();
}

function strColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},60%,40%)`;
}

export default function FeaturedStoresRow({ stores }: { stores: FeaturedStore[] }) {
  if (stores.length === 0) return null;

  return (
    <section aria-label="Trusted sellers" className="animate-fade-up">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1 h-6 bg-premium-gold rounded-full inline-block" />
          <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy">Trusted Sellers Near You</h2>
        </div>
        <Link href="/stores" className="text-xs font-semibold text-premium-gold hover:text-premium-gold-dark flex items-center gap-1 interactive">
          All Web Stores
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {stores.slice(0, 8).map((store) => {
          const name = store.partnerName || store.user.companyName || store.name;
          const src = store.partnerLogoUrl || store.logo;
          const countryLabel = COUNTRY_LABELS[store.user.country] || store.user.country;

          return (
            <Link
              key={store.id}
              href={`/stores/${store.slug}`}
              className="flex items-center gap-2.5 bg-white rounded-xl border border-gray-100 p-2.5 hover:border-premium-gold/50 hover:shadow-sm transition-all interactive"
            >
              <div className="relative w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center">
                {src ? (
                  <Image
                    src={resolveImageUrl(src)}
                    alt={`${name} logo`}
                    fill
                    className="object-contain p-1"
                    sizes="44px"
                  />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg,${strColor(name)}cc,${strColor(name)}88)` }}
                  >
                    <span className="text-white font-extrabold text-xs">{initials(name)}</span>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-gray-900 truncate flex items-center gap-1">
                  <span className="truncate">{name}</span>
                  {store.tier === 'PLATINUM' && <span title="Platinum store" aria-label="Platinum store" className="shrink-0 text-[9px] font-extrabold uppercase rounded px-1 py-px bg-slate-800 text-white">Plat</span>}
                  {store.tier === 'GOLD' && <span title="Gold store" aria-label="Gold store" className="shrink-0 text-[9px] font-extrabold uppercase rounded px-1 py-px bg-amber-400 text-amber-950">Gold</span>}
                </p>
                <p className="text-[11px] text-gray-500 truncate flex items-center gap-1">
                  {store.rating ? (
                    <>
                      <span className="text-premium-gold" aria-hidden="true">★</span>
                      <span>{store.rating.toFixed(1)}</span>
                      {store.ratingCount ? <span>({store.ratingCount})</span> : null}
                    </>
                  ) : (
                    <span>{store.partnerApproved ? 'Verified partner' : 'Seller'} · {countryLabel}</span>
                  )}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
