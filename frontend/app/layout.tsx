import type { Metadata, Viewport } from 'next';
import { getHTMLTextDir } from 'intlayer';
import { getLocale, IntlayerProvider } from 'next-intlayer/server';
import '@fontsource-variable/inter';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { CountryProvider } from '@/context/CountryContext';
import { SiteConfigProvider } from '@/context/SiteConfigContext';
import Footer from '@/components/layout/Footer';
import { ToastProvider } from '@/components/ui/Toast';
import AlertListener from '@/components/alerts/AlertListener';
import PublicShell from '@/components/layout/PublicShell';
import BackgroundImage from '@/components/layout/BackgroundImage';
import { API_URL } from '@/lib/apiUrl';
import { getSiteLogoUrl, imageMimeFromUrl } from '@/lib/siteLogo';
import { BrandLogoProvider } from '@/components/ui/BrandLogo';
import SiteIconSync from '@/components/ui/SiteIconSync';

const baseMetadata: Metadata = {
  title: 'Piitrade Marketplace - Uganda',
  description: 'Buy and sell anything in Uganda. Find the best deals on electronics, vehicles, real estate, and more. Millions of listings.',
  keywords: 'marketplace, buy, sell, Uganda, Kampala, classifieds, deals, electronics, vehicles',
  manifest: '/manifest.webmanifest',
  robots: { index: true, follow: true },
  // Default tab icons; generateMetadata swaps in the admin-uploaded Site Logo when there is one.
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: '48x48' }],
    apple: [{ url: '/apple-touch-icon.svg', type: 'image/svg+xml' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Piitrade',
  },
  openGraph: {
    type: 'website',
    siteName: 'Piitrade Marketplace',
    title: 'Piitrade Marketplace - Uganda',
    description: 'Buy and sell anything in Uganda. Find the best deals near you.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Piitrade Marketplace - Uganda',
    description: 'Buy and sell anything in Uganda. Find the best deals near you.',
  },
};

// The site name comes from Admin → Settings.
export async function generateMetadata(): Promise<Metadata> {
  let name = 'Piitrade';
  try {
    const res = await fetch(`${API_URL}/api/public/site-config`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const cfg = await res.json() as { siteName?: string };
      if (cfg.siteName && cfg.siteName.trim()) name = cfg.siteName.trim();
    }
  } catch { /* keep default */ }
  const logo = await getSiteLogoUrl({ fresh: true });
  const logoType = logo ? imageMimeFromUrl(logo) : undefined;
  const title = `${name} Marketplace - Uganda`;
  return {
    ...baseMetadata,
    title,
    // Browser-tab / bookmark / home-screen icon = the Site Logo (same single image as the header, footer, admin and sign-in pages).
    ...(logo ? { icons: { icon: [{ url: logo, ...(logoType ? { type: logoType } : {}) }], shortcut: [{ url: logo }], apple: [{ url: logo }] } } : {}),
    appleWebApp: { ...(baseMetadata.appleWebApp as object), title: name },
    openGraph: { ...(baseMetadata.openGraph as object), siteName: `${name} Marketplace`, title },
    twitter: { ...(baseMetadata.twitter as object), title },
  } as Metadata;
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F55906' },
    { media: '(prefers-color-scheme: dark)', color: '#F55906' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // `routing.mode: "no-prefix"` in intlayer.config.ts means there's no
  // [locale] URL segment — the locale is resolved from the cookie set by
  // `intlayerMiddleware` (see middleware.ts), falling back to
  // Accept-Language, then the configured default ("en").
  const locale = await getLocale();
  const siteLogoUrl = await getSiteLogoUrl({ fresh: true });

  return (
    <html lang={locale} dir={getHTMLTextDir(locale)}>
      <body className="font-sans">
        <IntlayerProvider locale={locale}>
        <BrandLogoProvider initialUrl={siteLogoUrl}>
        <SiteIconSync />
        <SiteConfigProvider>
        <CountryProvider>
          <AuthProvider>
              <ToastProvider>
                <AlertListener />
                <div className="relative isolate min-h-screen flex flex-col">
                  <BackgroundImage />
                  <PublicShell footer={<Footer />}>
                    {children}
                  </PublicShell>
                </div>
              </ToastProvider>
          </AuthProvider>
        </CountryProvider>
        </SiteConfigProvider>
        </BrandLogoProvider>
        </IntlayerProvider>
      </body>
    </html>
  );
}