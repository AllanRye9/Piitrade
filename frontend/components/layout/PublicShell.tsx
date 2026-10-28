'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import Header from '@/components/layout/Header';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import StickyHeaderBanner from '@/components/ui/StickyHeaderBanner';
import { CountryTransitionOverlay } from '@/components/ui/CountryTransitionOverlay';
import SupportChatWidget from '@/components/ui/SupportChatWidget';
import { useAuth } from '@/context/AuthContext';
import { useSiteConfig } from '@/context/SiteConfigContext';

const CountrySelectModal = dynamic(() => import('@/components/ui/CountrySelectModal'), {
  ssr: false,
});

const SessionExpiredModal = dynamic(() => import('@/components/ui/SessionExpiredModal'), {
  ssr: false,
});

export default function PublicShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const pathname = usePathname();
  // Publishes the sticky header's live height as --site-header-h so page-level sticky bars
  // (e.g. the listings filter bar) can dock directly beneath it at any breakpoint.
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--site-header-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pathname]);
  const isAdmin = pathname?.startsWith('/admin');
  const fullBleed = !!pathname && (pathname.startsWith('/profile') || pathname.startsWith('/dashboard'));
  const { user } = useAuth();
  const { maintenanceMode, siteName } = useSiteConfig();
  const isStaff = user?.role === 'ADMIN';
  // Maintenance Mode (Admin → Settings): everyone but admins sees a holding
  // page. Sign-in stays reachable so an admin can get back in.
  if (maintenanceMode && !isStaff && !pathname?.startsWith('/auth') && !isAdmin) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl" aria-hidden="true">🛠️</div>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">{siteName} is under maintenance</h1>
        <p className="mt-2 max-w-md text-sm text-gray-600">We&apos;re making improvements and will be back shortly. Thanks for your patience.</p>
        <a href="/auth/login" className="mt-6 text-xs text-gray-400 underline hover:text-gray-600">Admin sign in</a>
      </main>
    );
  }

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      {/*
       * ① Promo Header Banner (Admin → Site Media → "Promo Header Banner", 935 × 45 px).
       *    A top-only strip: it sits at the very top of the page and scrolls away with it. It is NOT sticky,
       *    so it can never overlap or hide the header/logo below it. It renders nothing when no banner is
       *    uploaded, and it never shows the Site Logo.
       */}
      {maintenanceMode && isStaff && (
        <div className="w-full bg-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-white">
          Maintenance mode is ON — visitors see a holding page. Only admins can see the site.
        </div>
      )}
      <div className="relative z-[51] w-full">
        <StickyHeaderBanner />
      </div>

      {/*
       * ② Main navigation header — the ONLY place the banner area is followed by branding: it shows the
       *    admin-uploaded Site Logo (Admin → Site Media → "Site Logo") in place of the default Piitrade icon +
       *    name + tagline, links to the homepage, and stays pinned to the top of the screen while scrolling.
       */}
      <div ref={headerRef} className="sticky top-0 z-50 w-full">
        <Header />
      </div>

      <CountrySelectModal />
      <SessionExpiredModal />
      <CountryTransitionOverlay />
      <main
        className={`flex-1 pt-0 pb-2 md:pb-2 px-0 md:px-0 has-bottom-nav`}
      >
        {/* Account area (/profile, /dashboard) is full-bleed: no max-width column, no side margin. */}
        <div className={fullBleed ? 'w-full' : 'mx-auto w-full max-w-[92rem]'}>{children}</div>
      </main>
      {/* The inbox is a fixed-height two-pane app: no footer below it, so the page never scrolls. */}
      {pathname?.startsWith('/messages') ? null : footer}
      <SupportChatWidget />
      <MobileBottomNav />
    </>
  );
}
