// Server-side helpers for the ONE site-wide logo (Admin → Site Media Manager → "Site Logo").
// Used by app/layout.tsx (tab icon + first-paint logo) and app/manifest.ts (installed-app icon).
// No client-only imports: safe in Server Components and route files.
import { API_URL } from '@/lib/apiUrl';

/**
 * Turns a stored logo URL into one the BROWSER can load. Server-side API_URL may be an internal
 * hostname (http://backend:5000), so backend paths use the public base when NEXT_PUBLIC_API_URL is
 * set, otherwise stay same-origin relative (next.config.mjs proxies /uploads and /api to the backend).
 */
export function publicAssetUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  const publicBase = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
  let path = url;
  try {
    const u = new URL(url);
    const backendPath = /^\/(api|uploads|media)\//.test(u.pathname);
    const staleHost = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /railway\.app|render\.com|vercel\.app/.test(u.hostname);
    if (!(backendPath && staleHost)) return url; // a real CDN / absolute URL: use as is
    path = `${u.pathname}${u.search}`;
  } catch { /* relative path */ }
  if (!path.startsWith('/')) path = `/${path}`;
  return /^\/(api|uploads|media)\//.test(path) && publicBase ? `${publicBase}${path}` : path;
}

/** Active Site Logo URL (browser-loadable) or null when none uploaded. Cached ~60 s, never throws. */
export async function getSiteLogoUrl(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/site-media?section=brand-logo`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { media?: { cdnUrl?: string | null }[] };
    const url = data.media?.[0]?.cdnUrl;
    return url ? publicAssetUrl(url) : null;
  } catch {
    return null;
  }
}

/** MIME type guessed from the file extension (omitted when unknown — browsers sniff it). */
export function imageMimeFromUrl(url: string): string | undefined {
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif' };
  return ext ? map[ext] : undefined;
}
