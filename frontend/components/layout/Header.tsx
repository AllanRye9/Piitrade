'use client';

import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCountry } from '@/context/CountryContext';
import { useCart } from '@/context/CartContext';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useRouter, usePathname } from 'next/navigation';
import CategoryBar from '@/components/layout/CategoryBar';
import { CountrySelector } from '@/components/ui/CountrySelector';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';
import { api } from '@/lib/api';
import type { Notification, NotificationType } from '@/lib/types';
import { useSiteConfig } from '@/context/SiteConfigContext';
import { FlagIcon } from '@/components/ui/FlagIcon'; // SVG flags — replace emoji
import BrandLogo from '@/components/ui/BrandLogo';

const NOTIF_ICONS: Partial<Record<NotificationType, string>> = {
  ORDER_PLACED: '📦',
  ORDER_CONFIRMED: '✅',
  ORDER_SHIPPED: '🚚',
  ORDER_DELIVERED: '🎉',
  ORDER_CANCELLED: '❌',
  PAYMENT_RECEIVED: '💳',
  PAYMENT_FAILED: '⚠️',
  LISTING_APPROVED: '✅',
  LISTING_REJECTED: '❌',
  REVIEW_POSTED: '⭐',
  MESSAGE_RECEIVED: '💬',
  WITHDRAWAL_APPROVED: '💰',
  WITHDRAWAL_REJECTED: '❌',
  SYSTEM: '🔔',
};

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30.44);
  return `${months}mo ago`;
}

const mobileNavItems = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/dashboard', label: 'My Dashboard', icon: '📊' },
  { href: '/listings', label: 'Browse Listings', icon: '🔍' },
  { href: '/motors', label: 'Motors', icon: '🚗' },
  { href: '/stores', label: 'Shop by Store', icon: '🏪' },
  { href: '/jobs', label: 'Job Market', icon: '💼' },
  { href: '/cv-services', label: 'CV Services', icon: '📋' },
  { href: '/listings/create', label: 'Sell Something', icon: '➕' },
  { href: '/cart', label: 'My Cart', icon: '🛒' },
  { href: '/profile/favorites', label: 'Saved Items', icon: '❤️' },
  { href: '/help', label: 'Help / FAQ', icon: '❓' },
  { href: '/terms', label: 'Terms & Conditions', icon: '📋' },
];

const DRAWER_HEADER_H = '68px';
const DRAWER_HEADER_WITH_USER_H = '140px';

const MOBILE_COUNTRY_OPTIONS = [
  { value: 'UAE' as const, flag: '🇦🇪', label: 'UAE', sub: 'United Arab Emirates' },
  { value: 'UGANDA' as const, flag: '🇺🇬', label: 'Uganda', sub: 'East Africa' },
  { value: 'KENYA' as const, flag: '🇰🇪', label: 'Kenya', sub: 'East Africa' },
  { value: 'CHINA' as const, flag: '🇨🇳', label: 'China', sub: 'Asia Pacific' },
];

function MobileCountryPicker({ onClose }: { onClose: () => void }) {
  const { country, setCountry } = useCountry();
  const router = useRouter();
  const SLUGS: Record<string, string> = { UAE: 'uae', UGANDA: 'uganda', KENYA: 'kenya', CHINA: 'china' };
  return (
    <div className="grid grid-cols-2 gap-2">
      {MOBILE_COUNTRY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => { setCountry(opt.value); onClose(); router.push('/country/' + SLUGS[opt.value]); }}
          className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all text-sm font-semibold ${
            opt.value === country
              ? 'border-sky-500 bg-sky-50 text-sky-700'
              : 'border-gray-200 text-gray-600 hover:border-sky-200 hover:bg-sky-50/60'
          }`}
        >
          {/* SVG flag — not emoji */}
          <div className="rounded overflow-hidden ring-1 ring-black/10 mb-0.5">
            <FlagIcon code={opt.value === 'UAE' ? 'AE' : opt.value === 'UGANDA' ? 'UG' : opt.value === 'KENYA' ? 'KE' : 'CN'} size={28} />
          </div>
          <span>{opt.label}</span>
          <span className="text-[10px] font-normal text-gray-400">{opt.sub}</span>
        </button>
      ))}
    </div>
  );
}

export default function Header() {
  const { user, logout } = useAuth();
  const { country } = useCountry();
  const { totalItems } = useCart();
  const { headerTheme } = useSiteConfig();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileDropOpen, setProfileDropOpen] = useState(false);
  const [browseDropOpen, setBrowseDropOpen] = useState(false);
  const [sellDropOpen, setSellDropOpen] = useState(false);
  const [helpDropOpen, setHelpDropOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifPreview, setNotifPreview] = useState<Notification[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();
  const profileDropRef = useRef<HTMLDivElement>(null);
  const browseDropRef = useRef<HTMLDivElement>(null);
  const sellDropRef = useRef<HTMLDivElement>(null);
  const helpDropRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // The admin-uploaded logo is only ever shown inline next to the
  // "piitrade EXCHANGE · Money Transfer Rates" text (see SiteAnalytics.tsx).
  // The header always shows the default 3R Elite wordmark.

  // Sync admin-set header theme to CSS variables on mount / change
  useEffect(() => {
    if (!headerTheme || typeof window === 'undefined') return;
    const themeMap: Record<string, { primary: string; dark: string; bg: string; text: string; textOn: string }> = {
      sky:      { primary: '#0EA5E9', dark: '#0284c7', bg: '#e0f2fe', text: '#0f172a', textOn: '#ffffff' },
      white:    { primary: '#64748b', dark: '#475569', bg: '#f1f5f9', text: '#111827', textOn: '#ffffff' },
      dark:     { primary: '#38bdf8', dark: '#0ea5e9', bg: '#0f172a', text: '#e2e8f0', textOn: '#0f172a' },
      emerald:  { primary: '#10b981', dark: '#059669', bg: '#ecfdf5', text: '#064e3b', textOn: '#ffffff' },
      violet:   { primary: '#7c3aed', dark: '#6d28d9', bg: '#f5f3ff', text: '#1e1b4b', textOn: '#ffffff' },
      rose:     { primary: '#f43f5e', dark: '#e11d48', bg: '#fff1f2', text: '#4c0519', textOn: '#ffffff' },
      amber:    { primary: '#f59e0b', dark: '#d97706', bg: '#fffbeb', text: '#451a03', textOn: '#1c1917' },
      indigo:   { primary: '#4f46e5', dark: '#4338ca', bg: '#eef2ff', text: '#1e1b4b', textOn: '#ffffff' },
      navy:     { primary: '#1d4ed8', dark: '#1e40af', bg: '#eff6ff', text: '#1e3a5f', textOn: '#ffffff' },
      ocean:    { primary: '#0891b2', dark: '#0e7490', bg: '#ecfeff', text: '#083344', textOn: '#ffffff' },
      teal:     { primary: '#0d9488', dark: '#0f766e', bg: '#f0fdfa', text: '#042f2e', textOn: '#ffffff' },
      gold:     { primary: '#ca8a04', dark: '#a16207', bg: '#fefce8', text: '#422006', textOn: '#ffffff' },
      midnight: { primary: '#818cf8', dark: '#6366f1', bg: '#0f0c29', text: '#c7d2fe', textOn: '#0f0c29' },
      forest:   { primary: '#16a34a', dark: '#15803d', bg: '#f0fdf4', text: '#052e16', textOn: '#ffffff' },
      coral:    { primary: '#ea580c', dark: '#c2410c', bg: '#fff7ed', text: '#431407', textOn: '#ffffff' },
      royal:    { primary: '#9333ea', dark: '#7e22ce', bg: '#faf5ff', text: '#3b0764', textOn: '#ffffff' },
    };
    const t = themeMap[headerTheme];
    if (!t) return;
    const root = document.documentElement;
    root.style.setProperty('--theme-primary', t.primary);
    root.style.setProperty('--theme-primary-dark', t.dark);
    root.style.setProperty('--theme-bg-light', t.bg);
    root.style.setProperty('--theme-text', t.text);
    root.style.setProperty('--theme-text-on-primary', t.textOn);
    if (headerTheme === 'dark' || headerTheme === 'midnight') {
      root.classList.add('theme-dark');
    } else {
      root.classList.remove('theme-dark');
    }
  }, [headerTheme]);

  useEffect(() => {
    setMenuOpen(false);
    setProfileDropOpen(false);
    setBrowseDropOpen(false);
    setSellDropOpen(false);
    setHelpDropOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileDropRef.current && !profileDropRef.current.contains(e.target as Node)) setProfileDropOpen(false);
      if (browseDropRef.current && !browseDropRef.current.contains(e.target as Node)) setBrowseDropOpen(false);
      if (sellDropRef.current && !sellDropRef.current.contains(e.target as Node)) setSellDropOpen(false);
      if (helpDropRef.current && !helpDropRef.current.contains(e.target as Node)) setHelpDropOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    const fetch = () => {
      api.get('/notifications/unread-count').then((r) => setUnreadCount(r.data.count ?? 0)).catch(() => {});
    };
    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => clearInterval(interval);
  }, [user]);

  const fetchNotifPreview = useCallback(() => {
    if (!user) return;
    setNotifLoading(true);
    api.get('/notifications?limit=4')
      .then((r) => {
        const items: Notification[] = r.data.notifications ?? [];
        setNotifPreview(items.slice(0, 4));
      })
      .catch(() => {})
      .finally(() => setNotifLoading(false));
  }, [user]);

  useEffect(() => {
    if (notifOpen) fetchNotifPreview();
  }, [notifOpen, fetchNotifPreview]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQ.trim()) params.set('q', searchQ.trim());
    if (searchCategory) params.set('category', searchCategory);
    params.set('country', country);
    router.push(`/listings?${params.toString()}`);
  };

  const handleMarkAllRead = () => {
    api.put('/notifications/read-all')
      .then(() => {
        setUnreadCount(0);
        setNotifPreview((prev) => prev.map((n) => ({ ...n, read: true })));
      })
      .catch(() => {});
  };

  return (
    <>
      <header
        className={`z-50 transition-all duration-500 ${scrolled ? 'bg-white/95 backdrop-blur-2xl border-b border-sky-100/80 shadow-[0_4px_32px_-4px_rgba(14,165,233,0.18),0_2px_8px_-2px_rgba(99,102,241,0.12)]' : 'shadow-[0_2px_24px_0_rgba(99,102,241,0.35)]'}`}
        style={scrolled ? undefined : { background: 'linear-gradient(135deg, var(--theme-primary-dark) 0%, var(--theme-primary) 50%, var(--theme-primary-dark) 100%)' }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-4 flex items-center gap-1.5 sm:gap-2 md:gap-3 h-14 sm:h-16">
          <button
            className="md:hidden p-2 rounded-lg text-white hover:bg-white/20 transition-colors animate-pulse-glow flex-shrink-0"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <div className="w-5 h-5 flex flex-col justify-center gap-[5px]">
              <span className={`block h-0.5 rounded-full bg-white transition-all duration-300 ${menuOpen ? 'rotate-45 translate-y-[6px]' : ''}`} />
              <span className={`block h-0.5 rounded-full bg-white transition-all duration-300 ${menuOpen ? 'opacity-0 scale-x-0' : ''}`} />
              <span className={`block h-0.5 rounded-full bg-white transition-all duration-300 ${menuOpen ? '-rotate-45 -translate-y-[6px]' : ''}`} />
            </div>
          </button>

          <Link href="/" className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 group hover:scale-105 active:scale-95 transition-all">
            <BrandLogo
              imgHeight={36}
              alt="3R Elite — Shop Smart. Shop Elite."
              fallback={
                <>
                  <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center font-black text-sm sm:text-base shadow-lg ${scrolled ? 'bg-gradient-to-br from-violet-600 via-sky-500 to-cyan-400 text-white animate-pulse-glow' : 'bg-white/20 text-white'}`}>3R</div>
                  <div className="flex flex-col leading-none gap-0.5">
                    <span className={`font-bold text-base sm:text-lg md:text-xl tracking-tight whitespace-nowrap ${scrolled ? 'text-elite-navy' : 'text-white'}`}>
                      <span className="font-extrabold">3R</span> <span className="italic font-serif">Elite</span>
                    </span>
                    <span className={`text-[9px] font-semibold uppercase tracking-[0.15em] whitespace-nowrap ${scrolled ? 'text-gray-400' : 'text-white/60'}`}>
                      Shop Smart. Shop Elite.
                    </span>
                  </div>
                </>
              }
            />
          </Link>

          <form onSubmit={handleSearch} className="hidden sm:flex flex-1 min-w-0 md:max-w-xl">
            <div className={`flex w-full rounded-xl overflow-hidden ring-2 transition-all shadow-lg ${scrolled ? 'ring-sky-200 focus-within:ring-fuchsia-400' : 'ring-white/30 focus-within:ring-white/70'}`}>
              {/* All Categories dropdown */}
              <select
                value={searchCategory}
                onChange={(e) => setSearchCategory(e.target.value)}
                className={`shrink-0 px-2 py-2 text-xs font-semibold border-r focus:outline-none cursor-pointer ${scrolled ? 'bg-gray-50 text-gray-700 border-gray-200' : 'bg-white/10 text-white border-white/20'}`}
                aria-label="Filter by category"
              >
                <option value="">All Categories</option>
                <option value="motors">Motors</option>
                <option value="property">Property</option>
                <option value="electronics">Electronics</option>
                <option value="fashion">Fashion</option>
                <option value="furniture">Furniture</option>
                <option value="jobs">Jobs</option>
                <option value="services">Services</option>
                <option value="classifieds">Classifieds</option>
              </select>
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search products, brands…"
                className={`flex-1 min-w-0 px-3 md:px-4 py-2 text-sm md:text-base focus:outline-none ${scrolled ? 'bg-white text-gray-900 placeholder:text-gray-400' : 'bg-white/10 text-white placeholder:text-white/60'}`}
              />
              <button
                type="submit"
                className={`px-3 md:px-4 py-2 text-sm md:text-base font-semibold flex-shrink-0 transition-colors ${scrolled ? 'bg-gradient-to-r from-violet-600 via-sky-600 to-cyan-500 text-white hover:brightness-110' : 'bg-elite-gold/90 text-white hover:bg-elite-gold'}`}
              >
                Search
              </button>
            </div>
          </form>

          <nav className="flex items-center gap-0.5 sm:gap-1 md:gap-1.5 ml-auto flex-shrink-0">
            <Link
              href="/"
              className={`relative p-1.5 sm:p-2 rounded-lg hidden sm:flex items-center justify-center transition-all group ${scrolled ? 'text-gray-600 hover:bg-red-50 hover:text-red-600' : 'text-white hover:bg-red-500/20'}`}
              aria-label="Home"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 22V12h6v10" />
              </svg>
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 group-hover:w-4/5 bg-red-500 rounded-full transition-all duration-200" />
            </Link>

            <div ref={browseDropRef} className="relative hidden sm:block">
              <button
                onClick={() => { setBrowseDropOpen((p) => !p); setSellDropOpen(false); }}
                className={`group relative flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${scrolled ? 'text-gray-700 hover:bg-red-50 hover:text-red-600 border border-gray-200 hover:border-red-200' : 'text-white hover:bg-red-500/20'}`}
                aria-expanded={browseDropOpen}
              >
                Browse
                <svg className={`w-3 h-3 transition-transform duration-200 ${browseDropOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 group-hover:w-4/5 bg-red-500 rounded-full transition-all duration-200" />
              </button>
              {browseDropOpen && (
                <div className="absolute left-0 top-full mt-1 w-52 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[200] animate-scale-in">
                  <div className="py-1.5">
                    {[
                      { href: '/browse/all', icon: '🌐', label: 'Browse All' },
                      { href: '/listings', icon: '🔍', label: 'All Listings' },
                      { href: '/motors', icon: '🚗', label: 'Motors' },
                      { href: '/stores', icon: '🏪', label: 'Shop by Store' },
                      { href: '/jobs', icon: '💼', label: 'Job Market' },
                      { href: '/cv-services', icon: '📋', label: 'CV Services' },
                      { href: '/listings?sort=views', icon: '🔥', label: 'Most Popular' },
                      { href: '/listings?sort=price_asc', icon: '💰', label: 'Best Deals' },
                      { href: '/country/uae', icon: '🇦🇪', label: 'UAE Marketplace' },
                      { href: '/country/uganda', icon: '🇺🇬', label: 'Uganda Marketplace' },
                      { href: '/country/kenya', icon: '🇰🇪', label: 'Kenya Marketplace' },
                      { href: '/country/china', icon: '🇨🇳', label: 'China Marketplace' },
                    ].map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setBrowseDropOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <span aria-hidden="true" style={{ fontSize: "1.1rem", lineHeight: 1, display: "inline-block", flexShrink: 0 }}>{item.icon}</span>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div ref={sellDropRef} className="relative hidden sm:block">
              <button
                onClick={() => { setSellDropOpen((p) => !p); setBrowseDropOpen(false); }}
                className={`group relative flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${scrolled ? 'bg-gradient-to-r from-violet-600 via-sky-600 to-cyan-500 text-white hover:from-red-500 hover:via-rose-500 hover:to-red-600 shadow-glow' : 'bg-white/20 text-white hover:bg-red-500/30 border border-white/30 hover:border-red-300/50'}`}
                aria-expanded={sellDropOpen}
              >
                Sell
                <svg className={`w-3 h-3 transition-transform duration-200 ${sellDropOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {sellDropOpen && (
                <div className="absolute left-0 top-full mt-1 w-52 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[200] animate-scale-in">
                  <div className="py-1.5">
                    {[
                      { href: '/listings/create', icon: '➕', label: 'Post a Listing' },
                      { href: user ? '/dashboard/store-rental' : '/auth/register?intent=store', icon: '🏪', label: user ? 'Set Up Your Store' : 'Open Your Store' },
                      { href: '/advertising', icon: '📣', label: 'Advertise' },
                      { href: '/profile/listings', icon: '📦', label: 'My Listings' },
                    ].map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setSellDropOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <span aria-hidden="true" style={{ fontSize: "1.1rem", lineHeight: 1, display: "inline-block", flexShrink: 0 }}>{item.icon}</span>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/profile/favorites"
              className={`relative p-2 rounded-lg hidden sm:flex items-center justify-center transition-all group ${scrolled ? 'text-gray-600 hover:bg-red-50 hover:text-red-600' : 'text-white hover:bg-red-500/20'}`}
              aria-label="Saved Items"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 group-hover:w-4/5 bg-red-500 rounded-full transition-all duration-200" />
            </Link>

            <Link
              href="/cart"
              className={`relative p-2 rounded-lg hidden sm:flex items-center justify-center transition-all group ${scrolled ? 'text-gray-600 hover:bg-red-50 hover:text-red-600' : 'text-white hover:bg-red-500/20'}`}
              aria-label="Shopping Cart"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              {totalItems > 0 && (
                <span
                  className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none"
                  aria-label={`${totalItems} item${totalItems !== 1 ? 's' : ''} in cart`}
                >
                  {totalItems > 9 ? '9+' : totalItems}
                </span>
              )}
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 group-hover:w-4/5 bg-red-500 rounded-full transition-all duration-200" />
            </Link>

            {user && (
              <div ref={notifRef} className="relative hidden sm:block">
                <button
                  onClick={() => setNotifOpen((p) => !p)}
                  className={`relative p-2 rounded-lg group flex items-center justify-center transition-all ${scrolled ? 'text-gray-600 hover:bg-red-50 hover:text-red-600' : 'text-white hover:bg-red-500/20'}`}
                  aria-label="Notifications"
                  aria-expanded={notifOpen}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[200] animate-scale-in">
                    <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-sky-600 to-indigo-700">
                      <p className="text-sm font-bold text-white">Notifications</p>
                      {unreadCount > 0 && (
                        <button onClick={handleMarkAllRead} className="text-xs text-sky-200 hover:text-white">Mark all read</button>
                      )}
                    </div>
                    <div className="overflow-y-auto max-h-72">
                      {notifLoading ? (
                        <div className="space-y-2 p-3">
                          {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="flex gap-3 animate-pulse">
                              <div className="w-8 h-8 rounded-full bg-gray-100 shrink-0" />
                              <div className="flex-1 space-y-1.5">
                                <div className="h-2.5 bg-gray-100 rounded w-3/4" />
                                <div className="h-2 bg-gray-100 rounded w-1/2" />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : notifPreview.length === 0 ? (
                        <p className="text-center text-sm text-gray-400 py-6">No notifications yet</p>
                      ) : (
                        <div className="divide-y divide-gray-50">
                          {notifPreview.map((notif) => (
                            <Link
                              key={notif.id}
                              href="/notifications"
                              onClick={() => setNotifOpen(false)}
                              className={`flex items-start gap-3 px-4 py-3 hover:bg-sky-50 transition-colors ${!notif.read ? 'bg-sky-50/60' : ''}`}
                            >
                              <span aria-hidden="true" style={{ fontSize: "1.5rem", lineHeight: 1, flexShrink: 0, marginTop: "0.125rem", display: "inline-block" }}>
                                {NOTIF_ICONS[notif.type] ?? '🔔'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-gray-800 truncate">{notif.title}</p>
                                <p className="text-[10px] text-gray-500 truncate mt-0.5">{notif.message}</p>
                                <p className="text-[9px] text-gray-400 mt-0.5">{relativeTime(notif.createdAt)}</p>
                              </div>
                              {!notif.read && <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0 mt-1.5" aria-hidden="true" />}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                    <Link href="/notifications" className="block text-center text-xs text-sky-600 hover:text-sky-800 py-3 border-t border-gray-100 font-semibold hover:bg-sky-50 transition-colors" onClick={() => setNotifOpen(false)}>
                      View All Notifications →
                    </Link>
                  </div>
                )}
              </div>
            )}

            <div ref={helpDropRef} className="relative hidden sm:block">
              <button
                onClick={() => { setHelpDropOpen((p) => !p); setBrowseDropOpen(false); setSellDropOpen(false); }}
                className={`relative p-2 rounded-lg group flex items-center justify-center transition-all ${scrolled ? 'text-gray-600 hover:bg-red-50 hover:text-red-600' : 'text-white hover:bg-red-500/20'}`}
                aria-label="Help"
                aria-expanded={helpDropOpen}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 group-hover:w-4/5 bg-red-500 rounded-full transition-all duration-200" />
              </button>
              {helpDropOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[200] animate-scale-in">
                  <div className="px-4 py-2.5 bg-gradient-to-r from-red-50 to-rose-50 border-b border-red-100">
                    <p className="text-xs font-bold text-red-700 uppercase tracking-wider">Support & Help</p>
                  </div>
                  <div className="py-1.5">
                    {[
                      { href: '/help', icon: '❓', label: 'Help Center' },
                      { href: '/safety', icon: '🛡️', label: 'Safety Tips' },
                      { href: '/about', icon: 'ℹ️', label: 'About Us' },
                      { href: '/terms', icon: '📋', label: 'Terms of Service' },
                      { href: '/privacy', icon: '🔒', label: 'Privacy Policy' },
                    ].map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setHelpDropOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <span aria-hidden="true" style={{ fontSize: "1.1rem", lineHeight: 1, display: "inline-block", flexShrink: 0 }}>{item.icon}</span>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                  <div className="px-4 py-3 bg-red-50 border-t border-red-100">
                    <p className="text-xs text-gray-500 mb-1">Contact support</p>
                    <a href="mailto:support@piitrade.com" className="text-xs font-semibold text-red-600 hover:text-red-700 transition-colors flex items-center gap-1.5" onClick={() => setHelpDropOpen(false)}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      support@piitrade.com
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="hidden sm:flex items-center gap-1.5">
              <ThemeSwitcher dropdown light />
              <CountrySelector light />
            </div>

            {user ? (
              <div ref={profileDropRef} className="relative hidden sm:block">
                <button
                  onClick={() => setProfileDropOpen((p) => !p)}
                  className={`flex items-center gap-1.5 text-sm rounded-lg p-1.5 transition-all ${scrolled ? 'text-gray-700 hover:bg-red-50 hover:text-red-600 ring-1 ring-gray-200 hover:ring-red-200' : 'text-white hover:bg-red-500/20'}`}
                  aria-label="My Account"
                  aria-expanded={profileDropOpen}
                >
                  <UserAvatar user={user} size="sm" />
                  <div className="hidden md:flex flex-col items-start leading-none gap-0.5">
                    <span className="font-medium">{user.name.split(' ')[0]}</span>
                    {user.role === 'ADMIN' && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ${scrolled ? 'bg-purple-100 text-purple-700' : 'bg-purple-400/30 text-purple-100'}`}>ADMIN</span>
                    )}
                  </div>
                  <svg className={`w-3.5 h-3.5 hidden md:block opacity-60 transition-transform duration-200 ${profileDropOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {profileDropOpen && (
                  <div className="absolute right-0 top-full mt-1 w-60 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[200] animate-scale-in">
                    <div className="px-4 py-3 bg-gradient-to-r from-rose-600 to-red-500">
                      <div className="flex items-center gap-3">
                        <UserAvatar user={user} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">{user.name}</p>
                          <p className="text-xs text-white/70 truncate font-mono">{user.personalId || user.email}</p>
                        </div>
                      </div>
                    </div>
                    <div className="py-1.5">
                      <Link href="/dashboard" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors font-medium" onClick={() => setProfileDropOpen(false)}>
                        <svg className="w-4 h-4 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        Dashboard
                      </Link>
                      <Link href="/profile" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors" onClick={() => setProfileDropOpen(false)}>
                        <svg className="w-4 h-4 shrink-0 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        My Profile
                      </Link>
                      <Link href="/profile/listings" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors" onClick={() => setProfileDropOpen(false)}>
                        <svg className="w-4 h-4 shrink-0 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        My Listings
                      </Link>
                      <Link href="/profile/orders" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors" onClick={() => setProfileDropOpen(false)}>
                        <svg className="w-4 h-4 shrink-0 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                        My Orders
                      </Link>
                      <Link href="/profile/favorites" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors" onClick={() => setProfileDropOpen(false)}>
                        <svg className="w-4 h-4 shrink-0 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                        Saved Items
                      </Link>
                      {user.role === 'ADMIN' && (
                        <Link href="/admin" className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-purple-700 hover:bg-purple-50 transition-colors" onClick={() => setProfileDropOpen(false)}>
                          <svg className="w-4 h-4 shrink-0 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Admin Panel
                        </Link>
                      )}
                    </div>
                    <div className="px-3 pb-3">
                      <button onClick={() => { logout(); setProfileDropOpen(false); }} className="flex w-full items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 font-semibold text-sm transition-colors border border-red-100">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Link href="/auth/login" className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${scrolled ? 'text-gray-700 hover:bg-red-50 hover:text-red-600 border border-gray-200 hover:border-red-200' : 'text-white/90 hover:text-white hover:bg-red-500/20 border border-white/30'}`}>Login</Link>
                <Link href="/auth/register" className={`hidden sm:flex text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${scrolled ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:from-red-600 hover:to-rose-700 shadow-sm' : 'bg-white text-red-600 hover:bg-red-50 border border-white/70 font-bold'}`}>Register</Link>
              </div>
            )}
          </nav>
        </div>

        <div className={`sm:hidden border-t px-3 py-2 ${scrolled ? 'border-sky-100 bg-white' : 'border-white/10 bg-indigo-800/40 backdrop-blur-sm'}`}>
          <form onSubmit={handleSearch} className="flex flex-col gap-1.5">
            <select
              value={searchCategory}
              onChange={(e) => setSearchCategory(e.target.value)}
              className={`w-full px-3 py-2 text-xs font-semibold rounded-lg border focus:outline-none ${scrolled ? 'bg-gray-50 text-gray-700 border-gray-200' : 'bg-white/10 text-white border-white/20'}`}
            >
              <option value="">All Categories</option>
              <option value="motors">Motors</option>
              <option value="property">Property</option>
              <option value="electronics">Electronics</option>
              <option value="fashion">Fashion</option>
              <option value="furniture">Furniture</option>
              <option value="jobs">Jobs</option>
              <option value="services">Services</option>
              <option value="classifieds">Classifieds</option>
            </select>
            <div className="flex rounded-lg overflow-hidden ring-2 ring-white/20">
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search products, brands and categories"
                className={`flex-1 min-w-0 px-3 py-2 text-sm focus:outline-none ${scrolled ? 'bg-white text-gray-900 placeholder:text-gray-400' : 'bg-white/10 text-white placeholder:text-white/60'}`}
              />
              <button type="submit" className={`px-4 py-2 text-sm font-semibold ${scrolled ? 'bg-elite-gold text-white hover:bg-elite-gold-dark' : 'bg-elite-gold/90 text-white hover:bg-elite-gold'}`}>
                Search
              </button>
            </div>
          </form>
        </div>

        <div className="hidden sm:block"><CategoryBar /></div>
      </header>

      <div
        className={`fixed inset-0 z-40 md:hidden transition-opacity duration-300 ${menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      </div>

      <div
        className={`fixed top-0 left-0 h-full w-72 max-w-[85vw] z-50 md:hidden bg-white shadow-2xl transform transition-transform duration-300 ease-in-out ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        aria-hidden={!menuOpen}
      >
        <div className="flex items-center justify-between px-4 py-4 text-white shadow-md theme-header-bg">
          <Link href="/" onClick={() => setMenuOpen(false)} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md flex items-center justify-center font-black text-sm bg-elite-gold/20 text-elite-gold">3R</div>
            <span className="font-extrabold text-lg">3R <span className="italic font-serif">Elite</span></span>
          </Link>
          <button onClick={() => setMenuOpen(false)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="Close menu">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {user && (
          <div className="px-4 py-3 theme-header-bg border-b border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar user={user} size="md" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                  <p className="text-xs text-white/70 truncate font-mono">{user.personalId || user.email}</p>
                </div>
              </div>
              <button onClick={() => { logout(); setMenuOpen(false); }} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-red-500 text-white text-xs font-semibold transition-colors" aria-label="Sign out">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                Sign Out
              </button>
            </div>
          </div>
        )}

        <nav className="overflow-y-auto" style={{ height: user ? `calc(100% - ${DRAWER_HEADER_WITH_USER_H})` : `calc(100% - ${DRAWER_HEADER_H})` }}>
          {mobileNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3.5 text-gray-700 hover:bg-gradient-to-r hover:from-sky-50 hover:to-fuchsia-50 hover:text-indigo-600 transition-colors font-medium text-sm border-b border-gray-50"
            >
              <span aria-hidden="true" style={{ fontSize: "1.4rem", lineHeight: 1, display: "inline-block", width: "1.5rem", textAlign: "center" }}>{item.icon}</span>
              {item.label}
            </Link>
          ))}

          {user?.role === 'ADMIN' && (
            <Link
              href="/admin"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3.5 text-purple-700 hover:bg-purple-50 transition-colors font-medium text-sm border-b border-gray-50"
            >
              <span aria-hidden="true" style={{ fontSize: "1.4rem", lineHeight: 1, display: "inline-block", width: "1.5rem", textAlign: "center" }}>⚙️</span>
              Admin Panel
            </Link>
          )}

          {!user && (
            <div className="px-4 py-4 mt-2 border-t border-gray-100 space-y-2">
              <Link href="/auth/login" onClick={() => setMenuOpen(false)} className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg theme-header-bg text-white font-semibold text-sm hover:brightness-110 transition-colors">
                Login
              </Link>
              <Link href="/auth/register" onClick={() => setMenuOpen(false)} className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border-2 border-sky-600 text-sky-700 font-semibold text-sm hover:bg-gradient-to-r hover:from-sky-50 hover:to-fuchsia-50 transition-colors">
                Create Account
              </Link>
            </div>
          )}

          <div className="px-4 py-4 border-t border-gray-100">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Marketplace Region</p>
            <MobileCountryPicker onClose={() => setMenuOpen(false)} />
          </div>
        </nav>
      </div>
    </>
  );
}