'use client';

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import Header from '@/components/layout/Header';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import StickyHeaderBanner from '@/components/ui/StickyHeaderBanner';
import { CountryTransitionOverlay } from '@/components/ui/CountryTransitionOverlay';
import MobileSpecialOffersPopup from '@/components/ui/MobileSpecialOffersPopup';
import MobileFloatingCartBar from '@/components/ui/MobileFloatingCartBar';
import SupportChatWidget from '@/components/ui/SupportChatWidget';
import { useCart } from '@/context/CartContext';
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
  const isAdmin = pathname?.startsWith('/admin');
  const { totalItems } = useCart();
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
  // The floating cart bar (see MobileFloatingCartBar) docks just above the
  // bottom nav and hides itself on /cart & /checkout — mirror that same
  // condition here so <main>'s extra bottom clearance only applies where
  // the bar itself would actually be showing.
  const cartBarShowing = totalItems > 0 && pathname !== '/cart' && !pathname?.startsWith('/checkout');

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
      {maintenanceMode && isStaff && (
        <div className="w-full bg-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-white">
          Maintenance mode is ON — visitors see a holding page. Only admins can see the site.
        </div>
      )}
      <div className="sticky top-0 z-[60] w-full">
        <StickyHeaderBanner />
      </div>

      {/*
       * ② Main navigation header — always shows the default Piitrade
       *    wordmark. The admin-uploaded logo is never shown here; it only
       *    ever appears inline next to the exchange widget text.
       */}
      <div className="sticky top-0 z-50 w-full">
        <Header />
      </div>

      <CountrySelectModal />
      <SessionExpiredModal />
      <CountryTransitionOverlay />
      <main
        className={`flex-1 pt-0 pb-4 md:pb-4 px-[1%] md:px-3 lg:px-4 ${cartBarShowing ? 'has-cart-bar' : 'has-bottom-nav'}`}
      >
        <div className="mx-auto w-full max-w-[92rem]">{children}</div>
      </main>
      {footer}
      {/*
       * Mobile-only floating deals shortcut — docked above the bottom nav
       * on every public page, mirroring the reference layout's persistent
       * "special offers" affordance. Renders nothing itself until tapped.
       */}
      <MobileSpecialOffersPopup />
      <MobileFloatingCartBar />
      <SupportChatWidget />
      <MobileBottomNav />
    </>
  );
}
