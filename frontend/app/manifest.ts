import type { MetadataRoute } from 'next';
import { getSiteLogoUrl, imageMimeFromUrl } from '@/lib/siteLogo';

// Installed-app (PWA) manifest. The app icon is the admin-uploaded Site Logo; with none uploaded the manifest
// declares no icon at all (nothing is shown).
export const revalidate = 60;

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const logo = await getSiteLogoUrl();
  const icons: MetadataRoute.Manifest['icons'] = logo
    ? [
        { src: logo, sizes: 'any', type: imageMimeFromUrl(logo), purpose: 'any' },
        { src: logo, sizes: '512x512', type: imageMimeFromUrl(logo), purpose: 'maskable' },
      ]
    : [];
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
