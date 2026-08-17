'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { resolveImageUrl } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Partner {
  id:                string;
  slug:              string;   // always present = always has a store page
  name:              string;
  partnerLogoUrl:    string | null;
  partnerName:       string | null;
  partnerWebsite:    string | null;
  partnerApprovedAt: string | null;
  logo:              string | null;
  user: {
    id:          string;
    name:        string;
    companyName: string | null;
    country:     string;
    website:     string | null;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COUNTRY_FLAGS:  Record<string, string> = { UAE: '🇦🇪', UGANDA: '🇺🇬', KENYA: '🇰🇪', CHINA: '🇨🇳' };
const COUNTRY_LABELS: Record<string, string> = { UAE: 'UAE', UGANDA: 'Uganda', KENYA: 'Kenya', CHINA: 'China' };

function displayName(p: Partner) {
  return p.partnerName || p.user.companyName || p.name;
}
function logoSrc(p: Partner) {
  return p.partnerLogoUrl || p.logo;
}
function externalSite(p: Partner): string | null {
  const w = p.partnerWebsite || p.user.website;
  if (!w) return null;
  return w.startsWith('http') ? w : `https://${w}`;
}
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

// ── Partner Card ──────────────────────────────────────────────────────────────
// Every approved partner always has a store (slug) because you need a store to
// become a partner.  Partners may also have an external website.
// Category label:  "With Store" (always) vs extra "Website" button when site exists.

function PartnerCard({ partner }: { partner: Partner }) {
  const name    = displayName(partner);
  const src     = logoSrc(partner);
  const site    = externalSite(partner);
  const hasStore = Boolean(partner.slug);     // always true for partners
  const hasSite  = Boolean(site);
  const hasBoth  = hasStore && hasSite;

  const flag   = COUNTRY_FLAGS[partner.user.country]  || '🌍';
  const label  = COUNTRY_LABELS[partner.user.country] || partner.user.country;

  // Category badge
  const categoryLabel = hasBoth
    ? 'Store & Website'
    : hasStore
    ? 'Has Store'
    : 'External Partner';

  const categoryColor = hasBoth
    ? 'bg-violet-100 text-violet-700'
    : hasStore
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-sky-100 text-sky-700';

  return (
    <div className="flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden group">

      {/* Category badge strip */}
      <div className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest text-center ${categoryColor}`}>
        {categoryLabel}
      </div>

      {/* Logo */}
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

        {/* Name + country */}
        <div className="text-center min-w-0 w-full">
          <p className="font-bold text-gray-800 text-sm leading-snug truncate">{name}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{flag} {label}</p>
        </div>

        <div className="flex-1" />

        {/* Redirection buttons */}
        <div className="w-full space-y-1.5 mt-1">
          {hasStore && (
            <Link
              href={`/stores/${partner.slug}`}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors"
            >
              🏪 Visit Store
            </Link>
          )}
          {hasSite && (
            <a
              href={site!}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl border border-gray-200 hover:border-sky-300 hover:bg-sky-50 text-gray-600 hover:text-sky-700 text-xs font-semibold transition-colors"
            >
              🌐 Visit Website
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function StoresPage() {
  const { user } = useAuth();

  const [partners, setPartners]                 = useState<Partner[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [filter, setFilter]                     = useState<'all' | 'store' | 'site'>('all');

  useEffect(() => {
    api.get('/stores/partners')
      .then(({ data }) => setPartners(data.partners || []))
      .catch(() => setPartners([]))
      .finally(() => setLoading(false));
  }, []);

  // Categorize
  const withStore    = partners.filter((p) => p.slug);
  const withSiteOnly = partners.filter((p) => !p.slug && externalSite(p));

  const visible = filter === 'store'
    ? withStore
    : filter === 'site'
    ? withSiteOnly
    : partners;

  return (
    <div className="min-h-screen bg-gray-50/90">

      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-sky-600 via-blue-700 to-indigo-800 py-10 px-4">
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 20% 50%,#ffffff22 0%,transparent 50%)' }}
        />
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-1.5 text-white/90 text-sm font-semibold mb-4">
            🤝 Partners &amp; Stores
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-2">Our Partners</h1>
          <p className="text-sky-100 text-base max-w-2xl mx-auto">
            Verified partners and stores approved by Piitrade across UAE, Uganda, Kenya and China.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-10">

        {/* Partners Wall */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-2xl font-extrabold text-gray-900">🤝 Our Partners</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Companies and organisations approved by Piitrade as official partners.
              </p>
            </div>
            {user && (
              <Link
                href="/dashboard/partner-logo"
                className="text-sm font-semibold text-sky-600 hover:text-sky-700 border border-sky-200 hover:bg-sky-50 px-4 py-2 rounded-xl transition-colors shrink-0"
              >
                Upload Partner Logo →
              </Link>
            )}
          </div>

          {/* Category filter tabs */}
          {!loading && partners.length > 0 && (
            <div className="flex gap-2 mb-5 flex-wrap">
              {[
                { key: 'all',   label: `All Partners (${partners.length})`,          color: 'bg-gray-800 text-white',         idle: 'bg-white text-gray-600 border border-gray-200 hover:border-gray-400' },
                { key: 'store', label: `With Store (${withStore.length})`,            color: 'bg-emerald-600 text-white',      idle: 'bg-white text-gray-600 border border-gray-200 hover:border-emerald-400' },
                { key: 'site',  label: `External Only (${withSiteOnly.length})`,      color: 'bg-sky-600 text-white',          idle: 'bg-white text-gray-600 border border-gray-200 hover:border-sky-400' },
              ].map(({ key, label, color, idle }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key as typeof filter)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${filter === key ? color : idle}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 animate-pulse">
                  <div className="w-20 h-20 bg-gray-200 rounded-xl mx-auto mb-3" />
                  <div className="h-3 bg-gray-100 rounded w-3/4 mx-auto mb-2" />
                  <div className="h-7 bg-gray-100 rounded-xl w-full mt-3" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-14 text-center">
              <p className="text-4xl mb-3">🤝</p>
              <p className="font-semibold text-gray-600 mb-1">
                {filter === 'all' ? 'No partners yet' : `No partners in this category`}
              </p>
              <p className="text-sm text-gray-400">
                {filter === 'all'
                  ? 'Admin-approved partners will appear here with their company logo.'
                  : 'Try a different filter above.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {visible.map((p) => (
                <PartnerCard key={p.id} partner={p} />
              ))}
            </div>
          )}
        </section>

        {/* Open a store CTA */}
        <div className="bg-gradient-to-r from-orange-400 via-pink-500 to-purple-600 rounded-2xl p-5 text-white">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold mb-1">📢 Open Your Store on Piitrade</h2>
              <p className="text-white/80 text-sm">List your products, reach buyers across 4 countries, get a verified storefront.</p>
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
          <h2 className="text-xl font-extrabold text-gray-900 text-center mb-6">How to Open Your Store</h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { icon: '🖊️', title: '1. Apply & Pay',    desc: 'Submit your store application with entity details and pay the activation fee.' },
              { icon: '✅', title: '2. Admin Approval',  desc: 'Admin reviews, activates your store, and may grant partner status.' },
              { icon: '🚀', title: '3. List & Partner',  desc: 'Upload your logo, add products, reach buyers. Approved partners appear here.' },
            ].map((item) => (
              <div key={item.title} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center text-3xl mx-auto mb-3 shadow-sm">
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
              className="inline-block px-8 py-3 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition-colors shadow-md"
            >
              Open Your Store Today
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
