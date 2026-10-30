'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { resolveImageUrl } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { T } from '@/components/ui/T';

// ── Types ─────────────────────────────────────────────────────────────────────

// Every store with `isActive: true` (GET /api/stores) — set on rental
// approval and cleared on expiry, see backend/src/routes/storeRentals.ts —
// counts as "approved and active" for this page. This is a broader set than
// `Partner` below: every approved+active store belongs here, but only the
// ones the admin has separately granted partner status also appear in the
// Partners Wall section.
interface WebStore {
  id:          string;
  slug:        string;
  name:        string;
  logo:        string | null;
  description: string | null;
  rating:      number;
  ratingCount: number;
  partnerApproved:   boolean;
  partnerLogoUrl:    string | null;
  partnerName:       string | null;
  user: {
    id:          string;
    name:        string;
    companyName: string | null;
    country:     string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COUNTRY_FLAGS:  Record<string, string> = { UGANDA: '🇺🇬' };
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

// ── Merchant Card ────────────────────────────────────────────────────────────
// Every approved & active store, regardless of partner status. Reuses the
// same name/logo/initials/color conventions as PartnerCard above so a store
// looks the same everywhere it appears in the app.

function WebStoreCard({ store }: { store: WebStore }) {
  const name  = store.partnerName || store.user.companyName || store.name;
  const src   = store.partnerLogoUrl || store.logo;
  const flag  = COUNTRY_FLAGS[store.user.country]  || '🌍';
  const label = COUNTRY_LABELS[store.user.country] || store.user.country;

  return (
    <Link
      href={`/stores/${store.slug}`}
      className="flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden group"
    >
      {store.partnerApproved && (
        <div className="px-3 py-1 text-[9px] font-black uppercase tracking-widest text-center bg-violet-100 text-violet-700">
          <T>Partner</T>
        </div>
      )}
      <div className="flex flex-col items-center gap-2 p-4 flex-1">
        <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
          {src ? (
            <Image
              src={resolveImageUrl(src)}
              alt={`${name} logo`}
              fill
              className="object-contain p-2 group-hover:scale-105 transition-transform duration-300"
              sizes="80px"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ background: `linear-gradient(135deg,${strColor(name)}cc,${strColor(name)}88)` }}
            >
              <span className="text-white font-extrabold text-xl">{initials(name)}</span>
            </div>
          )}
        </div>
        <div className="text-center min-w-0 w-full">
          <p className="font-bold text-gray-800 text-sm leading-snug truncate">{name}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{flag} {label}</p>
          {store.ratingCount > 0 && (
            <p className="text-[10px] text-amber-500 mt-0.5">★ {store.rating.toFixed(1)} ({store.ratingCount})</p>
          )}
        </div>
        <div className="flex-1" />
        <div className="w-full mt-1 py-2 rounded-xl bg-red-600 group-hover:bg-red-700 text-white text-xs font-bold text-center transition-colors">
          🏪 Visit Store
        </div>
      </div>
    </Link>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function StoresPage() {
  const { user } = useAuth();


  // All approved & active merchants — every store with isActive: true, not
  // just partner-approved ones (that narrower set is the Partners Wall
  // below). Paginated with "Load more" rather than assuming the backend's
  // 500-per-request cap covers every store on the platform.
  const [webStores, setWebStores]               = useState<WebStore[]>([]);
  const [webStoresLoading, setWebStoresLoading]  = useState(true);
  const [webStoresPage, setWebStoresPage]        = useState(1);
  const [webStoresTotal, setWebStoresTotal]      = useState(0);
  const [webStoresHasMore, setWebStoresHasMore]  = useState(false);
  const [loadingMore, setLoadingMore]            = useState(false);

  useEffect(() => {
    api.get('/stores', { params: { page: 1, limit: 60 } })
      .then(({ data }) => {
        setWebStores(data.stores || []);
        setWebStoresTotal(data.total || 0);
        setWebStoresHasMore((data.page || 1) < (data.pages || 1));
      })
      .catch(() => { setWebStores([]); setWebStoresTotal(0); setWebStoresHasMore(false); })
      .finally(() => setWebStoresLoading(false));
  }, []);

  const loadMoreWebStores = () => {
    const nextPage = webStoresPage + 1;
    setLoadingMore(true);
    api.get('/stores', { params: { page: nextPage, limit: 60 } })
      .then(({ data }) => {
        setWebStores((prev) => [...prev, ...(data.stores || [])]);
        setWebStoresPage(nextPage);
        setWebStoresHasMore((data.page || nextPage) < (data.pages || nextPage));
      })
      .catch(() => setWebStoresHasMore(false))
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="min-h-screen bg-gray-50/90">

      {/* Hero — compact banner, kept slim so the partners grid sits higher on the page */}
      <div className="relative overflow-hidden bg-gradient-to-r from-red-600 via-red-700 to-rose-800 py-4 px-4">
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%,#ffffff22 0%,transparent 50%)' }}
        />
        <div className="relative max-w-4xl mx-auto flex items-center justify-center gap-3 flex-wrap text-center">
          <span className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-white/90 text-xs font-semibold shrink-0">
            🏪 Merchants
          </span>
          <h1 className="text-lg md:text-xl font-extrabold text-white leading-tight"><T>Merchants</T></h1>
          <span className="hidden sm:inline text-red-100/90 text-xs">— Active Merchants approved by Piitrade across Uganda.</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-3 space-y-8">
        <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Merchants' }]} />

        {/* All Merchants — every approved & active store on the platform,
            not just partner-approved ones (see the Partners Wall below for
            that narrower, admin-curated set). */}
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
            <h2 className="text-2xl font-extrabold text-gray-900">🏪 Browse Merchants</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Every active Merchant account on Piitrade{webStoresTotal > 0 ? ` (${webStoresTotal})` : ''}.
            </p>
            </div>
          </div>

          {webStoresLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 animate-pulse">
                  <div className="w-20 h-20 bg-gray-200 rounded-xl mx-auto mb-3" />
                  <div className="h-3 bg-gray-100 rounded w-3/4 mx-auto mb-2" />
                  <div className="h-7 bg-gray-100 rounded-xl w-full mt-3" />
                </div>
              ))}
            </div>
          ) : webStores.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-14 text-center">
              <p className="text-4xl mb-3">🏪</p>
              <p className="font-semibold text-gray-600 mb-1"><T>No Merchants yet</T></p>
              <p className="text-sm text-gray-400"><T>Active Merchants will appear here.</T></p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {webStores.map((s) => (
                  <WebStoreCard key={s.id} store={s} />
                ))}
              </div>
              {webStoresHasMore && (
                <div className="text-center mt-5">
                  <button
                    onClick={loadMoreWebStores}
                    disabled={loadingMore}
                    className="px-6 py-2.5 rounded-xl border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-600 hover:text-red-700 text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'Load More Stores'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Open a store CTA */}
        <div className="bg-gradient-to-r from-orange-400 via-pink-500 to-purple-600 rounded-2xl p-5 text-white">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold mb-1">📢 Open Your Merchant Account on Piitrade</h2>
              <p className="text-white/80 text-sm"><T>List your products, reach buyers across Uganda, get a verified storefront.</T></p>
            </div>
            <Link
              href="/dashboard/store-rental"
              className="flex-shrink-0 px-6 py-3 rounded-xl bg-white text-purple-700 font-bold hover:bg-purple-50 transition-colors shadow-md whitespace-nowrap"
            >
              Open Your Store →
            </Link>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-xl font-extrabold text-gray-900 text-center mb-6"><T>How to Open Your Merchant Account</T></h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { icon: '🖊️', title: '1. Apply & Pay',    desc: 'Pass identity (KYC) verification, then submit your Merchant application and pay the activation fee.' },
              { icon: '✅', title: '2. Admin Approval',  desc: 'Admin reviews and activates your Merchant account.' },
              { icon: '🚀', title: '3. List & Partner',  desc: 'Upload your logo, add your products and reach buyers across Uganda.' },
            ].map((item) => (
              <div key={item.title} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center text-3xl mx-auto mb-3 shadow-sm">
                  {item.icon}
                </div>
                <h3 className="font-bold text-gray-900 mb-1 text-sm">{item.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-6">
            <Link
              href="/dashboard/store-rental"
              className="inline-block px-8 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold transition-colors shadow-md"
            >
              <T>Open Your Store Today</T>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
