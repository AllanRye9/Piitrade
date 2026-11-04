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
import { getSiteLogoUrl, imageMimeFromUrl, BLANK_ICON } from '@/lib/siteLogo';
import { BrandLogoProvider } from '@/components/ui/BrandLogo';
import SiteIconSync from '@/components/ui/SiteIconSync';
import { TranslationsProvider } from '@/components/i18n/TranslationsProvider';
import { DomTranslator } from '@/components/i18n/DomTranslator';
import { fetchOverrides } from '@/lib/i18n/overrides';
import { SITE_URL, jsonLdString, organizationJsonLd, websiteJsonLd } from '@/lib/seo';

const baseMetadata: Metadata = {
  // Makes every relative URL in metadata (Open Graph images, canonicals…) absolute.
  metadataBase: new URL(SITE_URL),
  // Search Console ownership: set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION to the token from "HTML tag" verification.
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } } : {}),
  formatDetection: { telephone: false },
  title: 'Piitrade Marketplace - Uganda',
  description: 'Buy and sell anything in Uganda. Find the best deals on electronics, vehicles, real estate, and more. Millions of listings.',
  keywords: 'marketplace, buy, sell, Uganda, Kampala, classifieds, deals, electronics, vehicles',
  manifest: '/manifest.webmanifest',
  robots: { index: true, follow: true },
  // No built-in tab icon on purpose: the tab shows the admin-uploaded Site Logo (generateMetadata) or nothing at all.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Piitrade',
  },
  openGraph: {
    type: 'website',
    siteName: 'Piitrade Marketplace',
    locale: 'en_UG',
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
async function getSiteName(): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/api/public/site-config`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const cfg = await res.json() as { siteName?: string };
      if (cfg.siteName && cfg.siteName.trim()) return cfg.siteName.trim();
    }
  } catch { /* keep default */ }
  return 'Piitrade';
}

export async function generateMetadata(): Promise<Metadata> {
  const name = await getSiteName();
  const logo = await getSiteLogoUrl({ fresh: true });
  const logoType = logo ? imageMimeFromUrl(logo) : undefined;
  const title = `${name} Marketplace - Uganda`;
  return {
    ...baseMetadata,
    title,
    // Browser-tab / bookmark / home-screen icon = ONLY the uploaded Site Logo. With none uploaded the tab shows nothing:
    // a transparent icon is declared so the browser does not fall back to guessing /favicon.ico.
    icons: logo
      ? { icon: [{ url: logo, ...(logoType ? { type: logoType } : {}) }], shortcut: [{ url: logo }], apple: [{ url: logo }] }
      : { icon: [{ url: BLANK_ICON, type: 'image/png' }], shortcut: [{ url: BLANK_ICON }] },
    appleWebApp: { ...(baseMetadata.appleWebApp as object), title: name },
    openGraph: { ...(baseMetadata.openGraph as object), siteName: `${name} Marketplace`, title, ...(logo && !logo.startsWith('data:') ? { images: [{ url: logo }] } : {}) },
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
  const [siteLogoUrl, siteName, translations] = await Promise.all([
    getSiteLogoUrl({ fresh: true }),
    getSiteName(),
    fetchOverrides(locale),
  ]);
  let apiOrigin = '';
  try { apiOrigin = process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : ''; } catch { /* not a URL */ }
  const siteJsonLd = [
    organizationJsonLd({ name: siteName, logoUrl: siteLogoUrl && !siteLogoUrl.startsWith('data:') ? siteLogoUrl : null }),
    websiteJsonLd({ name: siteName }),
  ];

  return (
    <html lang={locale} dir={getHTMLTextDir(locale)}>
      <head>
        {/* Open the API / image-host connection while the HTML is still being parsed. */}
        {apiOrigin && <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />}
        <link rel="dns-prefetch" href="https://api.country.is" />
      </head>
      <body className="font-sans">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(siteJsonLd) }} />
        <IntlayerProvider locale={locale}>
        <TranslationsProvider locale={locale} strings={translations}>
        <DomTranslator />
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
        </TranslationsProvider>
        </IntlayerProvider>
      </body>
    </html>
  );
}