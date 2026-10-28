import type { MetadataRoute } from 'next';
import { getSiteLogoUrl, imageMimeFromUrl } from '@/lib/siteLogo';

// Installed-app (PWA) manifest. The app icon is the admin-uploaded Site Logo when there is one,
// otherwise the built-in Piitrade icon. Replaces the old static public/manifest.json.
export const revalidate = 60;

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const logo = await getSiteLogoUrl();
  const icons: MetadataRoute.Manifest['icons'] = logo
    ? [
        { src: logo, sizes: 'any', type: imageMimeFromUrl(logo), purpose: 'any' },
        { src: logo, sizes: '512x512', type: imageMimeFromUrl(logo), purpose: 'maskable' },
      ]
    : [
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon', purpose: 'any' },
        { src: '/apple-touch-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ];
  return {
    name: 'Piitrade Marketplace',
    short_name: 'Piitrade',
    description: 'Buy and sell anything in Uganda',
    start_url: '/',
    display: 'standalone',
    background_color: '#0c4a6e',
    theme_color: '#0ea5e9',
    orientation: 'portrait-primary',
    icons,
    categories: ['shopping', 'business'],
    lang: 'en-US',
    dir: 'ltr',
    prefer_related_applications: false,
  };
}
