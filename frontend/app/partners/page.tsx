'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { resolveImageUrl } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { StoreSocialLinks, SocialLinksData } from '@/components/ui/StoreSocialLinks';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { T } from '@/components/ui/T';

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
    socialLinks: SocialLinksData | null;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const COUNTRY_FLAGS:  Record<string, string> = { UGANDA: '🇺🇬' };
const COUNTRY_LABELS: Record<string, string> = { UGANDA: 'Uganda' };

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
// Category label:  "With Web Store" (always) vs extra "Website" button when site exists.

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
    : 'bg-red-100 text-red-700';

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
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
            >
              🏪 Visit Store
            </Link>
          )}
          {hasSite && (
            <a
              href={site!}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-600 hover:text-red-700 text-xs font-semibold transition-colors"
            >
              🌐 Visit Website
            </a>
          )}
          {/* Social/contact links — only platforms this partner has actually
              set appear here (e.g. a WhatsApp number, group, or community link). */}
          <StoreSocialLinks links={partner.user.socialLinks} size="sm" className="justify-center pt-0.5" />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
// Partners are their own thing: companies Piitrade has verified (KYC) and approved. This page is
// independent of the Webstores directory at /stores — a partner simply may also run a webstore.

export default function PartnersPage() {
  const { user } = useAuth();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'all' | 'store' | 'site'>('all');

  useEffect(() => {
    api.get('/stores/partners')
      .then(({ data }) => setPartners(data.partners || []))
      .catch(() => setPartners([]))
      .finally(() => setLoading(false));
  }, []);

  const withStore    = partners.filter((p) => p.slug);
  const withSiteOnly = partners.filter((p) => !p.slug && externalSite(p));
  const visible = filter === 'store' ? withStore : filter === 'site' ? withSiteOnly : partners;

  return (
    <div className="min-h-screen bg-gray-50/90">
      <div className="relative overflow-hidden bg-gradient-to-r from-red-600 via-red-700 to-rose-800 py-4 px-4">
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%,#ffffff22 0%,transparent 50%)' }} />
        <div className="relative max-w-4xl mx-auto flex items-center justify-center gap-3 flex-wrap text-center">
          <span className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-white/90 text-xs font-semibold shrink-0">🤝 Partners</span>
          <h1 className="text-lg md:text-xl font-extrabold text-white leading-tight"><T>Our Partners</T></h1>
          <span className="hidden sm:inline text-red-100/90 text-xs">— Identity-verified companies and organisations approved by Piitrade.</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-3 space-y-8">
        <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Partners' }]} />

        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-2xl font-extrabold text-gray-900">🤝 Approved Partners</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                <T>Companies and organisations approved by Piitrade as official partners.</T>
              </p>
            </div>
            {user && (
              <Link
                href="/dashboard/partner-logo"
                className="text-sm font-semibold text-red-600 hover:text-red-700 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-xl transition-colors shrink-0"
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
                { key: 'store', label: `With Web Store (${withStore.length})`,            color: 'bg-emerald-600 text-white',      idle: 'bg-white text-gray-600 border border-gray-200 hover:border-emerald-400' },
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {visible.map((p) => (
                <PartnerCard key={p.id} partner={p} />
              ))}
            </div>
          )}
        </section>


        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <h2 className="text-lg font-extrabold text-gray-900 mb-1">Want to become a partner?</h2>
          <p className="text-sm text-gray-500 mb-4 max-w-xl mx-auto">
            Partners must pass identity (KYC) verification — a short form and a document upload — before Piitrade reviews the application.
          </p>
          <Link href="/profile/verification?for=partner" className="inline-block px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors">
            Start partner verification
          </Link>
        </div>
      </div>
    </div>
  );
}
