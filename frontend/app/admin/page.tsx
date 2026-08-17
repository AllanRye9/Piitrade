'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';
import { FlagIcon } from '@/components/ui/FlagIcon';

interface RecentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

interface RecentListing {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

interface Stats {
  users: number;
  listings: number;
  reports: number;
  activeListings: number;
  pendingListings: number;
  newUsersThisMonth: number;
  newListingsThisMonth: number;
  recentUsers: RecentUser[];
  recentListings: RecentListing[];
  listingsByStatus: Record<string, number>;
  usersByCountry: Record<string, number>;
  visitorCountries: string[];
  countryVisitCounts: Record<string, number>; // per-country visit counts e.g. { "AE": 42, "US": 15 }
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  SOLD: 'bg-blue-100 text-blue-700',
  EXPIRED: 'bg-gray-100 text-gray-600',
  REJECTED: 'bg-red-100 text-red-700',
};

const statusBarColors: Record<string, string> = {
  ACTIVE: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
  PENDING: 'bg-gradient-to-r from-amber-400 to-amber-500',
  SOLD: 'bg-gradient-to-r from-sky-400 to-sky-500',
  REJECTED: 'bg-gradient-to-r from-red-400 to-red-500',
  EXPIRED: 'bg-gray-400',
};



function StatCard({
  emoji,
  value,
  label,
  gradient,
  sub,
  href,
}: {
  emoji: string;
  value: string | number;
  label: string;
  gradient: string;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <div className={`${gradient} rounded-xl p-2.5 text-white shadow-md h-full flex flex-col justify-between group-hover:shadow-lg transition-shadow`}>
      <div className="flex items-start justify-between mb-1">
        <div className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center text-sm shadow-sm shrink-0">
          {emoji}
        </div>
        {href && (
          <div className="w-4 h-4 rounded-full bg-white/15 flex items-center justify-center shrink-0">
            <svg className="w-2 h-2 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        )}
      </div>
      <div>
        <div className="text-lg font-black tracking-tight leading-none">{typeof value === 'number' ? value.toLocaleString('en-US') : value}</div>
        <div className="text-white/75 text-[10px] font-medium mt-0.5 truncate">{label}</div>
        {sub && <div className="text-white/55 text-[9px] mt-0.5 truncate">↗ {sub}</div>}
      </div>
    </div>
  );
  if (href) return <Link href={href} className="block h-full group">{inner}</Link>;
  return inner;
}

// Map app country names to ISO 3166-1 alpha-2 codes for FlagIcon
const COUNTRY_ISO: Record<string, string> = {
  UAE: 'AE', UGANDA: 'UG', KENYA: 'KE', CHINA: 'CN',
};
// Full country name lookup — used by Countries Reached panel
const ISO_COUNTRY_NAMES: Record<string, string> = {
  AE:'UAE',          UG:'Uganda',        KE:'Kenya',         CN:'China',
  US:'United States',GB:'United Kingdom',IN:'India',         NP:'Nepal',
  EU:'Europe',       BD:'Bangladesh',    ZA:'South Africa',  NG:'Nigeria',
  GH:'Ghana',        TZ:'Tanzania',      ET:'Ethiopia',      PK:'Pakistan',
  RW:'Rwanda',       SS:'South Sudan',   MX:'Mexico',        BR:'Brazil',
  DE:'Germany',      FR:'France',        IT:'Italy',         ES:'Spain',
  CA:'Canada',       AU:'Australia',     JP:'Japan',         KR:'South Korea',
  SA:'Saudi Arabia', QA:'Qatar',         KW:'Kuwait',        BH:'Bahrain',
  OM:'Oman',         PH:'Philippines',   ID:'Indonesia',     MY:'Malaysia',
  TH:'Thailand',     VN:'Vietnam',       SG:'Singapore',     TR:'Turkey',
  EG:'Egypt',        MA:'Morocco',       DZ:'Algeria',       TN:'Tunisia',
  LY:'Libya',        SD:'Sudan',         SO:'Somalia',       DJ:'Djibouti',
  ER:'Eritrea',      MZ:'Mozambique',    ZM:'Zambia',        ZW:'Zimbabwe',
  MW:'Malawi',       BW:'Botswana',      NA:'Namibia',       AO:'Angola',
  CM:'Cameroon',     SN:'Senegal',       CI:'Côte d\'Ivoire',GN:'Guinea',
  ML:'Mali',         BF:'Burkina Faso',  NE:'Niger',         TD:'Chad',
  CF:'Cent. Africa', CG:'Congo',         CD:'DR Congo',      GA:'Gabon',
  IR:'Iran',         IQ:'Iraq',          SY:'Syria',         JO:'Jordan',
  LB:'Lebanon',      IL:'Israel',        YE:'Yemen',         AF:'Afghanistan',
  LK:'Sri Lanka',    MM:'Myanmar',       KH:'Cambodia',      LA:'Laos',
  MN:'Mongolia',     KZ:'Kazakhstan',    UZ:'Uzbekistan',    TM:'Turkmenistan',
  AZ:'Azerbaijan',   GE:'Georgia',       AM:'Armenia',       RU:'Russia',
  UA:'Ukraine',      PL:'Poland',        CZ:'Czech Rep.',    SK:'Slovakia',
  HU:'Hungary',      RO:'Romania',       BG:'Bulgaria',      GR:'Greece',
  RS:'Serbia',       HR:'Croatia',       BA:'Bosnia',        AL:'Albania',
  MK:'N. Macedonia', SI:'Slovenia',      AT:'Austria',       CH:'Switzerland',
  BE:'Belgium',      NL:'Netherlands',   DK:'Denmark',       SE:'Sweden',
  NO:'Norway',       FI:'Finland',       PT:'Portugal',      IE:'Ireland',
  NZ:'New Zealand',  FJ:'Fiji',          PG:'Papua N.G.',    SB:'Solomon Is.',
  VU:'Vanuatu',      WS:'Samoa',         TO:'Tonga',
};

export default function AdminDashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [now] = useState(() => new Date());
  const [sectionCounts, setSectionCounts] = useState<{
    target: number;
    countries: readonly string[];
    sections: Record<string, Record<string, number>>;
  } | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
    if (user?.role === 'ADMIN') {
      api.get('/admin/stats')
        .then(({ data }) => setStats(data))
        .catch(() => {})
        .finally(() => setStatsLoading(false));
      api.get('/admin/section-counts')
        .then(({ data }) => {
          // Only trust a well-formed response — this is purely for an
          // optional banner, so anything unexpected should just mean "don't
          // show the banner", never crash the dashboard.
          if (data && typeof data === 'object' && data.sections && typeof data.sections === 'object') {
            setSectionCounts(data);
          }
        })
        .catch(() => {});
    }
  }, [user, loading, router]);

  // Human-readable labels for the low-item warning banner — keys must match
  // the section keys returned by GET /admin/section-counts.
  const SECTION_LABELS: Record<string, string> = {
    FLASH_SALE: 'FLASH SALES',
    LATEST_COLLECTIONS: 'Latest Collections',
    FEATURED_DEAL: '✦ FEATURED DEAL',
    TODAYS_DEALS: "Today's Deals",
    OTHER_COLLECTIONS: 'Other Collections',
    RECENT_MOTORS: 'Recent Across Categories · Motors',
    RECENT_ELECTRONICS: 'Recent Across Categories · Electronics',
    RECENT_PROPERTY: 'Recent Across Categories · Property',
    RECENT_FASHION: 'Recent Across Categories · Latest Fashion',
  };
  const COUNTRY_LABELS: Record<string, string> = { UAE: 'UAE', UGANDA: 'Uganda', KENYA: 'Kenya', CHINA: 'China' };

  // Build the list of "country/section is short" shortfalls, capped so the
  // banner never grows unbounded if many rows are short at once. Defensively
  // guarded end-to-end: an unexpected or malformed /admin/section-counts
  // response must never crash the dashboard render — worst case, the banner
  // just doesn't show, rather than the whole page going blank.
  const shortfalls: { section: string; country: string; count: number }[] = [];
  if (sectionCounts && sectionCounts.sections && typeof sectionCounts.sections === 'object') {
    const target = sectionCounts.target ?? 6;
    for (const [section, byCountry] of Object.entries(sectionCounts.sections)) {
      if (!byCountry || typeof byCountry !== 'object') continue;
      for (const [country, count] of Object.entries(byCountry)) {
        if (typeof count === 'number' && count < target) shortfalls.push({ section, country, count });
      }
    }
  }

  if (loading || statsLoading) {
    return (
      <div className="space-y-2.5 animate-pulse" role="status" aria-live="polite">
        <span className="sr-only">Loading dashboard...</span>
        <div className="h-8 bg-gray-200 rounded-lg w-48" />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // Defensive against a malformed or partial /admin/stats response — the
  // exact same failure mode as the sectionCounts fix above: an unguarded
  // Object.values()/entries()/keys() on a missing field throws synchronously
  // during render and (with no error boundary on this page) takes down the
  // entire dashboard, not just the widget that depends on it. Computed once
  // here and reused everywhere below instead of guarding each call site.
  const listingsByStatus = stats.listingsByStatus || {};
  const usersByCountry = stats.usersByCountry || {};
  const recentUsers = stats.recentUsers || [];
  const recentListings = stats.recentListings || [];
  const visitorCountries = stats.visitorCountries || [];
  const maxListingCount = Math.max(...Object.values(listingsByStatus), 1);
  const maxCountryCount = Math.max(...Object.values(usersByCountry), 1);
  const approvalRate = stats.listings > 0
    ? Math.round((stats.activeListings / stats.listings) * 100)
    : 0;

  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-3">
      {/* Compact header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base font-extrabold text-gray-900 tracking-tight whitespace-nowrap">
            {greeting}, {user?.name.split(' ')[0]} 👋
          </h1>
          <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:inline">
            {now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shrink-0" />
            <span className="font-semibold">Live</span>
          </div>
          <Link
            href="/admin/settings"
            className="flex items-center gap-1 text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-2 py-0.5 hover:bg-gray-50 transition-colors font-medium"
          >
            ⚙️ Settings
          </Link>
        </div>
      </div>

      {/* ── Homepage row shortfall banner — always shown when any row is short ── */}
      {shortfalls.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="text-lg shrink-0">⚠️</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-900">
                {shortfalls.length} homepage row{shortfalls.length === 1 ? '' : 's'} {shortfalls.length === 1 ? 'has' : 'have'} fewer than {sectionCounts?.target ?? 6} items
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {shortfalls.slice(0, 8).map(({ section, country, count }) => (
                  <span
                    key={`${section}-${country}`}
                    className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                  >
                    {SECTION_LABELS[section] || section} · {COUNTRY_LABELS[country] || country}: {count}
                  </span>
                ))}
                {shortfalls.length > 8 && (
                  <span className="text-[10px] text-amber-600 self-center">+{shortfalls.length - 8} more</span>
                )}
              </div>
              <Link
                href="/admin/settings"
                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-900 underline"
              >
                Fix in Settings — auto-fill available for eligible rows →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* All 6 KPI cards in a single auto-fit row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <StatCard
          emoji="👥"
          value={stats.users}
          label="Total Users"
          gradient="bg-gradient-to-br from-sky-500 to-sky-600"
          sub={`+${stats.newUsersThisMonth} this month`}
          href="/admin/users"
        />
        <StatCard
          emoji="📋"
          value={stats.listings}
          label="Total Listings"
          gradient="bg-gradient-to-br from-purple-500 to-purple-600"
          sub={`+${stats.newListingsThisMonth} this month`}
          href="/admin/listings"
        />
        <StatCard
          emoji="✅"
          value={stats.activeListings}
          label="Active"
          gradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
          sub={`${approvalRate}% approval`}
          href="/admin/listings"
        />
        <StatCard
          emoji="⏳"
          value={stats.pendingListings}
          label="Pending"
          gradient="bg-gradient-to-br from-amber-400 to-amber-500"
          sub="Awaiting approval"
          href="/admin/submissions"
        />
        <StatCard
          emoji="🚩"
          value={stats.reports}
          label="Reports"
          gradient="bg-gradient-to-br from-red-500 to-red-600"
          sub="Needs attention"
          href="/admin/reports"
        />
        <StatCard
          emoji="🆕"
          value={stats.newUsersThisMonth}
          label="New/Month"
          gradient="bg-gradient-to-br from-[#0284c7] to-[#0369a1]"
        />
      </div>

      {/* Alert banner for pending items */}
      {stats.pendingListings > 0 && (
        <div role="alert" className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">⚠️</span>
            <p className="text-xs font-bold text-amber-900 truncate">
              {stats.pendingListings} listing{stats.pendingListings !== 1 ? 's' : ''} awaiting review
            </p>
          </div>
          <Link
            href="/admin/submissions"
            className="shrink-0 text-xs font-bold bg-amber-500 text-white px-2.5 py-1 rounded-lg hover:bg-amber-600 transition-colors shadow-sm ml-3"
          >
            Review →
          </Link>
        </div>
      )}

      {/* Main data — 4 horizontal panels */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">

        {/* Recent Users */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
            <h2 className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
              <span className="w-1 h-3.5 bg-sky-500 rounded-full" />
              Recent Users
            </h2>
            <Link href="/admin/users" className="text-[10px] text-sky-600 hover:text-sky-700 font-semibold">
              All →
            </Link>
          </div>
          <div className="overflow-hidden flex-1">
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="text-left text-gray-400 bg-gray-50/80 text-[9px] uppercase tracking-wider">
                  <th className="px-3 py-1.5 font-semibold">Name</th>
                  <th className="px-3 py-1.5 font-semibold">Role</th>
                  <th className="px-3 py-1.5 font-semibold hidden lg:table-cell">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentUsers.slice(0, 5).map((u) => (
                  <tr key={u.id} className="hover:bg-sky-50/50 transition-colors">
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold text-gray-900 text-[11px] truncate">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-block px-1 py-0.5 rounded-full text-[8px] font-bold ${
                        u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-400 text-[10px] hidden lg:table-cell whitespace-nowrap">{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
                {recentUsers.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400 text-xs">No users yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Listings */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
            <h2 className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
              <span className="w-1 h-3.5 bg-purple-500 rounded-full" />
              Recent Listings
            </h2>
            <Link href="/admin/listings" className="text-[10px] text-sky-600 hover:text-sky-700 font-semibold">
              All →
            </Link>
          </div>
          <div className="overflow-hidden flex-1">
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="text-left text-gray-400 bg-gray-50/80 text-[9px] uppercase tracking-wider">
                  <th className="px-3 py-1.5 font-semibold">Title</th>
                  <th className="px-3 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentListings.slice(0, 5).map((l) => (
                  <tr key={l.id} className="hover:bg-purple-50/30 transition-colors">
                    <td className="px-3 py-1.5 font-semibold text-[11px] text-gray-900 truncate max-w-[100px]">{l.title}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-block px-1 py-0.5 rounded-full text-[8px] font-bold ${
                        statusColors[l.status] || 'bg-gray-100 text-gray-600'
                      }`}>
                        {l.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {recentListings.length === 0 && (
                  <tr><td colSpan={2} className="px-3 py-4 text-center text-gray-400 text-xs">No listings yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Listings by Status */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex flex-col">
          <h2 className="font-bold text-gray-900 text-xs mb-2 flex items-center gap-1.5 shrink-0">
            <span className="w-1 h-3.5 bg-emerald-500 rounded-full" />
            By Status
          </h2>
          <div className="space-y-1.5 flex-1">
            {Object.entries(listingsByStatus).map(([status, count]) => (
              <div key={status}>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className={`inline-block px-1 py-0.5 rounded-full text-[8px] font-bold ${statusColors[status] || 'bg-gray-100 text-gray-600'}`}>
                    {status}
                  </span>
                  <span className="text-gray-500 font-mono text-[9px]">
                    {count} ({stats.listings > 0 ? Math.round((count / stats.listings) * 100) : 0}%)
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1">
                  <div
                    className={`h-1 rounded-full transition-all duration-700 ${statusBarColors[status] || 'bg-gray-400'}`}
                    style={{ width: `${(count / maxListingCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {Object.keys(listingsByStatus).length === 0 && (
              <p className="text-xs text-gray-400 text-center py-2">No data</p>
            )}
          </div>
        </div>

        {/* Users by Country + Quick Actions */}
        <div className="flex h-full flex-col gap-2.5">
          {/* Users by Country */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex-1">
            <h2 className="font-bold text-gray-900 text-xs mb-2 flex items-center gap-1.5">
              <span className="w-1 h-3.5 rounded-full" style={{ background: '#C5A059' }} />
              By Country
            </h2>
            <div className="space-y-1.5">
              {Object.entries(usersByCountry).map(([country, count]) => (
                <div key={country}>
                  <div className="flex items-center justify-between text-[10px] mb-0.5">
                    <span className="text-gray-700 font-semibold text-[11px]">
                      {(COUNTRY_ISO[country] ? <FlagIcon code={COUNTRY_ISO[country]} size={7} className="inline-block mr-1" /> : <span className="mr-1">🌍</span>)}{country}
                    </span>
                    <span className="text-gray-500 font-mono text-[9px]">
                      {count} ({stats.users > 0 ? Math.round((count / stats.users) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1">
                    <div
                      className="h-1 rounded-full bg-gradient-to-r from-[#0284c7] to-[#0EA5E9] transition-all duration-700"
                      style={{ width: `${(count / maxCountryCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              {Object.keys(usersByCountry).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">No data</p>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2.5">
            <h2 className="font-bold text-gray-900 text-xs mb-2 flex items-center gap-1.5">
              <span className="w-1 h-3.5 rounded-full" style={{ background: '#C5A059' }} />
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {[
                { href: '/admin/analytics', icon: '📊', label: 'Analytics', color: 'bg-sky-50 text-sky-700 border-sky-100 hover:bg-sky-100' },
                { href: '/admin/submissions', icon: '📥', label: 'Submit', color: 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100' },
                { href: '/admin/images', icon: '🖼️', label: 'Images', color: 'bg-violet-50 text-violet-700 border-violet-100 hover:bg-violet-100' },
                { href: '/admin/categories', icon: '🏷️', label: 'Categ.', color: 'bg-purple-50 text-purple-700 border-purple-100 hover:bg-purple-100' },
                { href: '/admin/users', icon: '👥', label: 'Users', color: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100' },
                { href: '/admin/listings', icon: '📋', label: 'Lists', color: 'bg-sky-50 text-sky-700 border-sky-100 hover:bg-sky-100' },
                { href: '/admin/jobs', icon: '💼', label: 'Jobs', color: 'bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100' },
                { href: '/admin/reports', icon: '🚩', label: 'Reports', color: 'bg-red-50 text-red-700 border-red-100 hover:bg-red-100' },
              ].map(({ href, icon, label, color }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-lg text-[9px] font-semibold border transition-all ${color} hover:shadow-sm`}
                >
                  <span className="text-base leading-none">{icon}</span>
                  <span className="text-center leading-tight">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Countries Reached ── list with visit counts ───────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🌍</span>
            <div>
              <h2 className="font-black text-white text-sm tracking-wide">Countries Reached</h2>
              <p className="text-violet-200 text-[10px]">Visitor origins detected via Cloudflare IP · sorted by visit count</p>
            </div>
          </div>
          <div className="bg-white/20 border border-white/30 rounded-xl px-3 py-1.5 text-center">
            <p className="text-white font-black text-lg leading-none">{visitorCountries.length}</p>
            <p className="text-violet-200 text-[9px] font-semibold uppercase tracking-wider">countr{visitorCountries.length !== 1 ? 'ies' : 'y'}</p>
          </div>
        </div>

        <div className="p-4">
          {visitorCountries.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-2">🌐</div>
              <p className="text-sm font-semibold text-gray-500">No visitor data yet</p>
              <p className="text-xs text-gray-400 mt-1">Countries appear here automatically as users access the site.</p>
            </div>
          ) : (
            <>
              {/* List view — flag + country name + visit count, sorted by visits descending */}
              <ul className="divide-y divide-gray-100">
                {[...visitorCountries]
                  .sort((a, b) => {
                    // Sort by visit count descending; fall back to alphabetical for ties
                    const countA = stats.countryVisitCounts?.[a.toUpperCase()] ?? 0;
                    const countB = stats.countryVisitCounts?.[b.toUpperCase()] ?? 0;
                    return countB - countA || a.localeCompare(b);
                  })
                  .map((code, idx) => {
                    const upperCode = code.toUpperCase();
                    const name = ISO_COUNTRY_NAMES[upperCode] ?? upperCode;
                    // Visits tracked via countryVisitCounts; show 0 if not yet tracked (legacy entries)
                    const visits = stats.countryVisitCounts?.[upperCode] ?? 0;
                    // Find max visits for the progress bar
                    const maxVisits = Math.max(
                      1,
                      ...Object.values(stats.countryVisitCounts ?? {}),
                    );
                    const pct = Math.round((visits / maxVisits) * 100);
                    return (
                      <li key={code} className="flex items-center gap-3 py-2.5 px-1 hover:bg-violet-50 rounded-lg transition-colors group">
                        {/* Rank */}
                        <span className="text-[10px] font-mono text-gray-400 w-5 text-right shrink-0">
                          {idx + 1}
                        </span>
                        {/* Flag */}
                        <div className="rounded overflow-hidden shadow-sm ring-1 ring-black/10 shrink-0">
                          <FlagIcon code={upperCode} size={21} />
                        </div>
                        {/* Country name + ISO code */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-bold text-gray-800 truncate group-hover:text-violet-700">
                              {name}
                            </span>
                            <span className="text-[10px] font-semibold text-violet-600 shrink-0">
                              {visits.toLocaleString('en-US')} {visits === 1 ? 'visit' : 'visits'}
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        {/* ISO code badge */}
                        <span className="text-[9px] font-mono text-gray-400 bg-gray-100 group-hover:bg-violet-100 rounded px-1.5 py-0.5 shrink-0">
                          {upperCode}
                        </span>
                      </li>
                    );
                  })}
              </ul>
              <p className="mt-3 text-[9px] text-gray-400 text-right">
                ISO 3166-1 alpha-2 · auto-detected from CF-IPCountry header
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
