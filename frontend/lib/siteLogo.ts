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

/**
 * Active Site Logo URL (browser-loadable), null when none is uploaded, or undefined when it could not be
 * determined (backend unreachable) — callers must not treat undefined as "no logo".
 * `fresh: true` skips the 60 s data cache so an upload is reflected on the very next page load.
 */
// Last answer the backend gave this server process. A slow or failed request returns this instead of
// "unknown", so the tab icon and first-paint logo never flip to the default for a moment (the on/off flicker).
let lastKnown: string | null | undefined;

export async function getSiteLogoUrl(opts: { fresh?: boolean } = {}): Promise<string | null | undefined> {
  try {
    const res = await fetch(`${API_URL}/api/site-media?section=brand-logo`, {
      ...(opts.fresh ? { cache: 'no-store' as const } : { next: { revalidate: 60 } }),
      signal: AbortSignal.timeout(opts.fresh ? 4000 : 4000),
    });
    if (!res.ok) return lastKnown;
    const data = (await res.json()) as { media?: { cdnUrl?: string | null }[] };
    const url = data.media?.[0]?.cdnUrl;
    lastKnown = url ? publicAssetUrl(url) : null;
    return lastKnown;
  } catch {
    return lastKnown;
  }
}

/** MIME type guessed from the file extension (omitted when unknown — browsers sniff it). */
export function imageMimeFromUrl(url: string): string | undefined {
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif' };
  return ext ? map[ext] : undefined;
}
