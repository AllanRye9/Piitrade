import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { CountryProvider } from '@/context/CountryContext';
import { CartProvider } from '@/context/CartContext';
import { SiteConfigProvider } from '@/context/SiteConfigContext';
import Footer from '@/components/layout/Footer';
import { ToastProvider } from '@/components/ui/Toast';
import PublicShell from '@/components/layout/PublicShell';
import { resolveImageUrl } from '@/lib/utils';

const SITE_MEDIA_API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export const metadata: Metadata = {
  title: 'Piitrade Marketplace - UAE, Uganda, Kenya & China',
  description: 'Buy and sell anything in UAE, Uganda, Kenya and China. Find the best deals on electronics, vehicles, real estate, and more. Millions of listings.',
  keywords: 'marketplace, buy, sell, UAE, Uganda, Kenya, China, Dubai, Kampala, Nairobi, Beijing, classifieds, deals, electronics, vehicles',
  manifest: '/manifest.json',
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-touch-icon.svg', type: 'image/svg+xml' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Piitrade',
  },
  openGraph: {
    type: 'website',
    siteName: 'Piitrade Marketplace',
    title: 'Piitrade Marketplace - UAE, Uganda, Kenya & China',
    description: 'Buy and sell anything in UAE, Uganda, Kenya and China. Find the best deals near you.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Piitrade Marketplace - UAE, Uganda, Kenya & China',
    description: 'Buy and sell anything in UAE, Uganda, Kenya and China. Find the best deals near you.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0EA5E9' },
    { media: '(prefers-color-scheme: dark)', color: '#0EA5E9' },
  ],
};

async function getBackgroundImage(): Promise<string | null> {
  try {
    const response = await fetch(`${SITE_MEDIA_API_BASE}/api/site-media?section=background`, {
      next: { revalidate: 300 },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const firstMedia = Array.isArray(data?.media)
      ? data.media.find((item: { cdnUrl?: string | null }) => item?.cdnUrl)
      : null;

    return firstMedia?.cdnUrl ? resolveImageUrl(firstMedia.cdnUrl) : null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const backgroundImage = await getBackgroundImage();

  return (
    <html lang="en">
      <body className="font-sans">
        <SiteConfigProvider>
        <CountryProvider>
          <AuthProvider>
            <CartProvider>
              <ToastProvider>
                <div className="relative isolate min-h-screen flex flex-col">
                  {backgroundImage && (
                    <>
                      <div
                        className="pointer-events-none fixed inset-0 -z-20 bg-cover bg-center bg-no-repeat"
                        style={{ backgroundImage: `url("${backgroundImage}")` }}
                      />
                      <div className="site-bg-overlay pointer-events-none fixed inset-0 -z-10" />
                    </>
                  )}
                  <PublicShell footer={<Footer />}>
                    {children}
                  </PublicShell>
                </div>
              </ToastProvider>
            </CartProvider>
          </AuthProvider>
        </CountryProvider>
        </SiteConfigProvider>
      </body>
    </html>
  );
}