'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { resolveImageUrl } from '@/lib/utils';

interface DashStats {
  totalListings: number;
  activeListings: number;
  totalViews: number;
  savedItems: number;
}

const XP_PER_LISTING = 50;
const XP_PER_VIEW = 2;

function xpLevel(xp: number) {
  const levels = [
    { min: 0, label: 'Newcomer', color: 'from-gray-400 to-gray-500', badge: '🌱', next: 100 },
    { min: 100, label: 'Trader', color: 'from-green-500 to-emerald-600', badge: '⚡', next: 300 },
    { min: 300, label: 'Pro Seller', color: 'from-sky-500 to-blue-600', badge: '🔵', next: 700 },
    { min: 700, label: 'Ace', color: 'from-violet-500 to-purple-600', badge: '💜', next: 1500 },
    { min: 1500, label: 'Champion', color: 'from-amber-500 to-orange-600', badge: '🏆', next: 3000 },
    { min: 3000, label: 'Legend', color: 'from-red-500 to-rose-600', badge: '🔥', next: null },
  ];
  let current = levels[0];
  for (const level of levels) {
    if (xp >= level.min) current = level;
  }
  return current;
}

const quickLinks = [
  { href: '/listings/create', icon: '➕', label: 'Post Listing', color: 'bg-gradient-to-br from-rose-500 to-red-600', desc: 'Earn 50 XP' },
  { href: '/listings', icon: '🔍', label: 'Browse', color: 'bg-gradient-to-br from-sky-500 to-blue-600', desc: 'Find deals' },
  { href: '/notifications', icon: '🔔', label: 'Updates', color: 'bg-gradient-to-br from-violet-500 to-purple-600', desc: 'Stay informed' },
  { href: '/profile/favorites', icon: '❤️', label: 'Saved', color: 'bg-gradient-to-br from-pink-500 to-rose-600', desc: 'Wishlist' },
  { href: '/portal/settings', icon: '⚙️', label: 'Settings', color: 'bg-gradient-to-br from-amber-500 to-orange-600', desc: 'Manage portal' },
  { href: '/stores', icon: '🏪', label: 'Stores', color: 'bg-gradient-to-br from-emerald-500 to-green-600', desc: 'Shop local' },
];

const achievements = [
  { icon: '🥇', label: 'First Listing', desc: 'Post your first listing', unlocked: false },
  { icon: '🤝', label: 'First Sale', desc: 'Complete a transaction', unlocked: false },
  { icon: '⭐', label: 'Top Rated', desc: 'Get 5-star reviews', unlocked: false },
  { icon: '🚀', label: 'Power Seller', desc: 'Post 10+ listings', unlocked: false },
];

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashStats>({ totalListings: 0, activeListings: 0, totalViews: 0, savedItems: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  const [topListings, setTopListings] = useState<{ id: string; title: string; views: number; images: string[]; status: string }[]>([]);

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login?redirect=/dashboard');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setStatsLoading(true);
    Promise.allSettled([
      api.get('/listings?limit=1&mine=true'),
      api.get('/listings?limit=100&mine=true'),
      api.get('/profile/favorites').catch(() => ({ data: { favorites: [] } })),
    ]).then(([, allRes]) => {
      if (allRes.status === 'fulfilled') {
        const listings = allRes.value.data.listings || [];
        const active = listings.filter((l: { status: string }) => l.status === 'ACTIVE');
        const views = listings.reduce((acc: number, l: { views?: number }) => acc + (l.views || 0), 0);
        setStats({
          totalListings: allRes.value.data.total || listings.length,
          activeListings: active.length,
          totalViews: views,
          savedItems: 0,
        });
        // Top 3 listings by views
        const sorted = [...listings].sort((a: { views?: number }, b: { views?: number }) => (b.views || 0) - (a.views || 0)).slice(0, 3);
        setTopListings(sorted);
      }
    }).finally(() => setStatsLoading(false));
  }, [user]);

  if (loading || !user) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-red-200 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  const xp = stats.totalListings * XP_PER_LISTING + stats.totalViews * XP_PER_VIEW;
  const level = xpLevel(xp);
  const xpProgress = level.next ? Math.min(100, Math.round(((xp - level.min) / (level.next - level.min)) * 100)) : 100;

  const statCards = [
    { label: 'Total Listings', value: statsLoading ? '—' : stats.totalListings, icon: '📦', color: 'text-sky-600', bg: 'bg-sky-50 border-sky-200' },
    { label: 'Active Listings', value: statsLoading ? '—' : stats.activeListings, icon: '✅', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
    { label: 'Total Views', value: statsLoading ? '—' : stats.totalViews, icon: '👁️', color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200' },
    { label: 'XP Points', value: statsLoading ? '—' : xp, icon: level.badge, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-red-50/30 to-rose-50/20">
      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        <Breadcrumb
          items={[
            { label: 'Home', href: '/' },
            { label: 'Dashboard' },
          ]}
        />

        {/* Hero banner */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-red-600 via-rose-600 to-pink-600 shadow-2xl p-4 sm:p-6">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-80 h-80 bg-white rounded-full -translate-y-40 translate-x-40" />
            <div className="absolute bottom-0 left-0 w-60 h-60 bg-white rounded-full translate-y-32 -translate-x-20" />
          </div>
          <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="ring-4 ring-white/30 rounded-2xl overflow-hidden">
                <UserAvatar user={user} size="lg" />
              </div>
              <div>
                <p className="text-white/70 text-sm font-medium">Welcome back 👋</p>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">{user.name.split(' ')[0]}</h1>
                <p className="text-white/60 text-xs mt-0.5">{user.email}</p>
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-2">
              <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/20 text-white text-sm font-bold`}>
                <span className="text-lg">{level.badge}</span>
                <span>{level.label}</span>
              </div>
              {/* XP Progress bar */}
              <div className="w-full sm:w-48">
                <div className="flex justify-between text-[11px] text-white/70 mb-1">
                  <span>{xp} XP</span>
                  {level.next && <span>Next: {level.next} XP</span>}
                </div>
                <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-700"
                    style={{ width: `${xpProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <div key={card.label} className={`rounded-2xl border p-3 sm:p-4 ${card.bg} flex flex-col gap-1.5`}>
              <span className="text-2xl">{card.icon}</span>
              <span className={`text-2xl sm:text-3xl font-extrabold ${card.color}`}>{card.value}</span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{card.label}</span>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
            <span className="w-1 h-5 bg-red-500 rounded-full inline-block" />
            Quick Actions
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`${link.color} rounded-2xl p-3 flex flex-col items-center gap-1.5 text-white shadow-md hover:shadow-lg hover:scale-105 active:scale-95 transition-all`}
              >
                <span className="text-2xl">{link.icon}</span>
                <span className="text-xs font-bold text-center leading-tight">{link.label}</span>
                <span className="text-[10px] text-white/70">{link.desc}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Achievements & Activity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Achievements */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-base font-bold text-gray-900 mb-2 flex items-center gap-2">
              <span className="text-xl">🏆</span> Achievements
            </h2>
            <div className="space-y-3">
              {achievements.map((a) => (
                <div
                  key={a.label}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    a.unlocked
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-gray-50 border-gray-100 opacity-60'
                  }`}
                >
                  <span className="text-2xl">{a.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-gray-800">{a.label}</p>
                    <p className="text-xs text-gray-500">{a.desc}</p>
                  </div>
                  {a.unlocked ? (
                    <span className="ml-auto text-amber-500 text-xs font-bold px-2 py-0.5 bg-amber-100 rounded-full">Earned!</span>
                  ) : (
                    <span className="ml-auto text-gray-400 text-xs font-medium px-2 py-0.5 bg-gray-100 rounded-full">Locked</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Getting Started */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-base font-bold text-gray-900 mb-2 flex items-center gap-2">
              <span className="text-xl">🚀</span> Get Started
            </h2>
            <div className="space-y-3">
              {[
                { label: 'Complete your profile', href: '/profile', done: !!(user.name && user.email) },
                { label: 'Post your first listing', href: '/listings/create', done: stats.totalListings > 0 },
                { label: 'Browse the marketplace', href: '/listings', done: true },
                { label: 'Enable notifications', href: '/profile', done: false },
              ].map((task) => (
                <Link
                  key={task.label}
                  href={task.href}
                  className={`flex items-center gap-3 p-3 rounded-xl border hover:border-red-200 hover:bg-red-50 transition-colors group ${
                    task.done ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${task.done ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500 group-hover:bg-red-200 group-hover:text-red-600'}`}>
                    {task.done ? '✓' : '→'}
                  </span>
                  <span className={`text-sm font-medium ${task.done ? 'text-emerald-700 line-through' : 'text-gray-700 group-hover:text-red-600'}`}>
                    {task.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Top Performing Listings */}
        {topListings.length > 0 && (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span className="text-xl">📈</span> Top Listings
              </h2>
              <Link href="/profile/listings" className="text-xs font-semibold text-sky-600 hover:text-sky-700">
                Manage all →
              </Link>
            </div>
            <div className="space-y-2">
              {topListings.map((listing, i) => (
                <Link
                  key={listing.id}
                  href={`/listings/${listing.id}`}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-100 hover:border-sky-200 hover:bg-sky-50 transition-colors group"
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-gray-300 text-gray-700' : 'bg-amber-700/60 text-white'}`}>
                    {i + 1}
                  </span>
                  {listing.images?.[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveImageUrl(listing.images[0])}
                      alt={listing.title}
                      className="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                  )}
                  <span className="flex-1 text-sm font-semibold text-gray-800 line-clamp-1 group-hover:text-sky-700">{listing.title}</span>
                  <span className="text-xs text-gray-500 shrink-0">👁 {listing.views}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Leaderboard teaser */}
        <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 rounded-3xl p-4 text-white shadow-xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold mb-1">🏅 Climb the Leaderboard</h2>
              <p className="text-white/70 text-sm max-w-sm">
                Post listings, complete sales, and earn XP to unlock top-tier status and exclusive perks.
              </p>
            </div>
            <Link
              href="/listings/create"
              className="shrink-0 px-6 py-3 bg-white text-violet-700 font-bold rounded-2xl hover:bg-violet-50 transition-colors shadow-lg text-sm"
            >
              Start Earning XP →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { badge: '🌱', label: 'Newcomer', xp: '0+' },
              { badge: '⚡', label: 'Trader', xp: '100+' },
              { badge: '🔵', label: 'Pro', xp: '300+' },
              { badge: '💜', label: 'Ace', xp: '700+' },
              { badge: '🏆', label: 'Champ', xp: '1500+' },
              { badge: '🔥', label: 'Legend', xp: '3000+' },
            ].map((tier) => (
              <div key={tier.label} className={`flex flex-col items-center gap-1 p-2.5 rounded-xl bg-white/10 text-center ${xp >= parseInt(tier.xp.replace('+', ''), 10) ? 'ring-2 ring-white/40' : 'opacity-60'}`}>
                <span className="text-xl">{tier.badge}</span>
                <span className="text-[10px] font-bold text-white/90">{tier.label}</span>
                <span className="text-[9px] text-white/50">{tier.xp} XP</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </main>
  );
}
