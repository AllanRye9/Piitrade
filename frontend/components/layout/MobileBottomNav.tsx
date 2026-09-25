'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useIntlayer } from 'next-intlayer';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

const navItems = [
  {
    href: '/',
    key: 'home' as const,
    // Piitrade brand mark ("P") in the site's orange brand colour, in place
    // of a generic house icon — bold enough to stay legible at nav-bar
    // size, with its own active/inactive treatment (filled vs. outlined)
    // independent of the label-text colour swap used by the other items.
    icon: (active: boolean) => (
      <span
        aria-hidden="true"
        className={`flex items-center justify-center w-5 h-5 rounded-md text-[13px] font-black leading-none transition-colors ${
          active
            ? 'bg-premium-gold text-white shadow-sm'
            : 'bg-premium-gold/10 text-premium-gold border border-premium-gold/40'
        }`}
        style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
      >
        P
      </span>
    ),
  },
  {
    href: '/listings',
    key: 'browse' as const,
    icon: (active: boolean) => (
      <svg className="w-5 h-5" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={active ? 0 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    href: '/listings/create',
    key: 'sell' as const,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    icon: (_active: boolean) => (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    ),
    isSell: true,
  },
  {
    href: '/messages',
    key: 'chats' as const,
    icon: (active: boolean) => (
      <svg className="w-5 h-5" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={active ? 0 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    requiresAuth: true,
  },
  {
    href: '/profile',
    // Renamed from "Profile" to "Account" on mobile (desktop nav is
    // unaffected — this component only renders below the md breakpoint).
    key: 'account' as const,
    icon: (active: boolean) => (
      <svg className="w-5 h-5" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={active ? 0 : 1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];

function renderNavLink(item: (typeof navItems)[number], isActive: boolean, href: string, label: string, badgeCount?: number) {
  return (
    <Link
      key={item.href}
      href={href}
      className={`flex flex-col items-center justify-center py-2 flex-1 gap-0.5 interactive transition-colors ${
        isActive ? 'text-premium-gold' : 'text-gray-400 hover:text-gray-600'
      }`}
      aria-label={badgeCount ? `${label} (${badgeCount} unread)` : label}
      aria-current={isActive ? 'page' : undefined}
    >
      <div className={`relative p-1 rounded-xl transition-all ${isActive ? 'bg-premium-gold/10' : ''}`}>
        {item.icon(Boolean(isActive))}
        {!!badgeCount && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none ring-2 ring-white">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </div>
      <span className={`text-[10px] font-medium ${isActive ? 'font-semibold' : ''}`}>{label}</span>
    </Link>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const labels = useIntlayer('mobileBottomNav');
  const labelFor = (item: (typeof navItems)[number]): string => String(labels[item.key]);
  const [unreadChats, setUnreadChats] = useState(0);

  useEffect(() => {
    if (!user) { setUnreadChats(0); return; }
    const fetchCount = () => {
      api.get('/messages/unread-count').then((r) => setUnreadChats(r.data.count ?? 0)).catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, [user]);

  if (pathname && pathname.startsWith('/admin')) return null;

  const isActive = (item: (typeof navItems)[number]) =>
    Boolean(item.href === '/' ? pathname === '/' : pathname && pathname.startsWith(item.href) && item.href !== '/');
  const hrefFor = (item: (typeof navItems)[number]) =>
    (('requiresAuth' in item || item.key === 'account') && !user ? '/auth/login' : item.href);
  const badgeFor = (item: (typeof navItems)[number]) => (item.key === 'chats' ? unreadChats : undefined);

  const sellItem = navItems.find((item) => item.isSell)!;
  // Everything else splits evenly across the two halves of the bar so the
  // Sell button — positioned absolutely below — lands at the true
  // horizontal centre of the screen rather than wherever a plain flex
  // distribution of unequal-count items would happen to put it.
  const otherItems = navItems.filter((item) => !item.isSell);
  const leftItems = otherItems.slice(0, Math.ceil(otherItems.length / 2));
  const rightItems = otherItems.slice(Math.ceil(otherItems.length / 2));

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Mobile navigation"
    >
      <div className="relative bg-white border-t border-gray-100 shadow-[0_-4px_24px_0_rgb(0,0,0,0.08)]">
        <div className="flex items-stretch px-1">
          <div className="flex flex-1 items-stretch justify-evenly">
            {leftItems.map((item) => renderNavLink(item, isActive(item), hrefFor(item), labelFor(item), badgeFor(item)))}
          </div>

          {/* Spacer matching the floating Sell button's footprint, so the
              left/right groups don't creep under it. */}
          <div className="w-16 shrink-0" aria-hidden="true" />

          <div className="flex flex-1 items-stretch justify-evenly">
            {rightItems.map((item) => renderNavLink(item, isActive(item), hrefFor(item), labelFor(item), badgeFor(item)))}
          </div>
        </div>

        {/* Sell — floats dead-centre of the bar (not just centred among the
            other flex items), elevated above the bar like a FAB. */}
        <Link
          href={hrefFor(sellItem)}
          className="absolute left-1/2 -translate-x-1/2 -top-5 flex flex-col items-center justify-center interactive group"
          aria-label={labelFor(sellItem)}
        >
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-premium-gold to-premium-gold-dark flex items-center justify-center text-white shadow-lg group-active:scale-95 transition-transform">
            {sellItem.icon(false)}
          </div>
          <span className="text-[10px] font-medium text-premium-gold mt-0.5">{labelFor(sellItem)}</span>
        </Link>
      </div>
    </nav>
  );
}
