'use client';

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import Header from '@/components/layout/Header';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import StickyHeaderBanner from '@/components/ui/StickyHeaderBanner';
import { CountryTransitionOverlay } from '@/components/ui/CountryTransitionOverlay';

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
  const isAdmin = pathname?.startsWith('/admin');

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      {/*
       * ① Promo banner — 935 × 45 px — first element on every public page.
       *    The outer strip fills full width; the image is centred at 935 px.
       *    z-[60] keeps it above the header's z-50.
       */}
      <div className="sticky top-0 z-[60] w-full">
        <StickyHeaderBanner />
      </div>

      {/*
       * ② Main navigation header — always shows the default 3R Elite
       *    wordmark. The admin-uploaded logo is never shown here; it only
       *    ever appears inline next to the exchange widget text.
       */}
      <div className="sticky top-0 z-50 w-full">
        <Header />
      </div>

      <CountrySelectModal />
      <SessionExpiredModal />
      <CountryTransitionOverlay />
      <main className="flex-1 pt-0 pb-4 has-bottom-nav md:pb-4 px-[1%] md:px-[7%]">
        {children}
      </main>
      {footer}
      <MobileBottomNav />
    </>
  );
}
