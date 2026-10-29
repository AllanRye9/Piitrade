'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

/**
 * BrandLogo
 *
 * Renders the full "Piitrade" brand lockup — the icon box, the "Piitrade"
 * name, and the "Shop Smart. Shop Trusted." tagline — as ONE unified image
 * whenever an admin has uploaded a logo via Site Media Manager → "Site Logo".
 * When no logo has been uploaded, it falls
 * back to rendering the original text/markup passed in via `fallback`.
 *
 * This component only swaps the *content*; the surrounding <Link href="/">
 * that click-routes the logo to the homepage stays exactly where each
 * caller already has it, so that behaviour is preserved either way.
 */

// Module-level cache/in-flight promise shared across every instance on the page (header, footer, admin and
// sign-in all ask for it) so they share one request. The cache is deliberately short: an upload or replacement
// by an admin must show up quickly everywhere, not after a reload.
const CACHE_TTL_MS = 5_000;
const STORAGE_KEY = 'piitrade:brandLogo';          // last known good logo URL (instant, flash-free next visit)
const BUMP_KEY = 'piitrade:brandLogoUpdatedAt';    // written on upload so OTHER open tabs refresh at once
let cachedLogoUrl: string | null | undefined;      // undefined = unknown, null = confirmed "no logo uploaded"
let cachedAt = 0;
let inFlight: Promise<string | null | undefined> | null = null;
let lastKnownLogo: string | null = null;
let nullStreak = 0;
let acceptNullNow = false;

function readStored(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStored(url: string | null) {
  try { if (url) window.localStorage.setItem(STORAGE_KEY, url); else window.localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ }
}

/**
 * The active Site Logo URL. Resolves to a string (logo uploaded), null (confirmed: none uploaded) or undefined
 * (could not be determined — network error). A failed request is NEVER treated as "no logo": callers keep what
 * they already show, so the default icon cannot replace an uploaded logo because of a hiccup.
 */
export function fetchBrandLogo(): Promise<string | null | undefined> {
  if (cachedLogoUrl !== undefined && Date.now() - cachedAt < CACHE_TTL_MS) return Promise.resolve(cachedLogoUrl);
  if (inFlight) return inFlight;
  inFlight = api
    .get(`/site-media?section=brand-logo&_t=${Date.now()}`)
    .then(({ data }) => {
      const items = data?.media || [];
      let url: string | null = items[0]?.cdnUrl || null;
      // A single empty answer after we had a logo is more likely a hiccup than a real removal: keep the logo and
      // confirm on the next check (an admin removal calls refreshBrandLogo, which accepts it at once).
      if (url === null) {
        const known = lastKnownLogo ?? readStored();
        if (known && !acceptNullNow && nullStreak < 1) { nullStreak += 1; url = known; }
      } else { nullStreak = 0; }
      acceptNullNow = false;
      if (url) lastKnownLogo = url;
      cachedLogoUrl = url;
      cachedAt = Date.now();
      writeStored(url);
      return url;
    })
    .catch((): string | null | undefined => (cachedLogoUrl !== undefined ? cachedLogoUrl : undefined))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * First-paint value of the Site Logo, resolved on the server (app/layout.tsx) so the logo is already in the
 * HTML: no flash of the "Pi" / "Piitrade" fallback while the browser fetches it. A context (not a module
 * variable) so nothing leaks between requests on the server. `undefined` = not known, fetch on the client
 * (the header then reserves the space invisibly rather than flashing the default logo).
 */
const BrandLogoContext = createContext<string | null | undefined>(undefined);

export function BrandLogoProvider({ initialUrl, children }: { initialUrl: string | null | undefined; children: React.ReactNode }) {
  return <BrandLogoContext.Provider value={initialUrl}>{children}</BrandLogoContext.Provider>;
}

/** Call after the admin uploads / replaces / removes the Site Logo: every logo and the tab icon update at once, in every open tab. */
export function refreshBrandLogo() {
  acceptNullNow = true;
  cachedLogoUrl = undefined;
  cachedAt = 0;
  inFlight = null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('site-brand-logo-updated'));
    try { window.localStorage.setItem(BUMP_KEY, String(Date.now())); } catch { /* ignore */ }
  }
}

/** Re-checks the logo whenever it may have changed: refresh by the admin (this or another tab), tab focus, and a slow poll. */
export function useBrandLogoRevalidation(onChange: () => void) {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === BUMP_KEY) { cachedLogoUrl = undefined; cachedAt = 0; onChange(); } };
    const onVisible = () => { if (document.visibilityState === 'visible') onChange(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onChange);
    document.addEventListener('visibilitychange', onVisible);
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') onChange(); }, 15_000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(poll);
    };
  }, [onChange]);
}

interface BrandLogoProps {
  /** Original icon + "Piitrade" + tagline markup, shown until/unless a logo image exists. */
  fallback: React.ReactNode;
  /** Height in px for the rendered logo image. */
  imgHeight?: number;
  /** Extra classes for the <img>. */
  imgClassName?: string;
  alt?: string;
}

export default function BrandLogo({
  fallback,
  imgHeight = 32,
  imgClassName = '',
  alt = 'Piitrade — Shop Smart. Shop Trusted.',
}: BrandLogoProps) {
  const initial = useContext(BrandLogoContext);
  // `undefined` = not known yet (render an invisible placeholder, never the default logo); `null` = confirmed none.
  // The server-provided value is already browser-safe (lib/siteLogo.ts); client-fetched URLs go through resolveImageUrl.
  const [logoUrl, setLogoUrl] = useState<string | null | undefined>(
    typeof cachedLogoUrl === 'string' ? resolveImageUrl(cachedLogoUrl) : cachedLogoUrl === null ? null : initial,
  );
  // Image that failed to load: retry once with a cache-buster (a stale CDN edge or a half-written upload) before
  // giving up. Only after that does the default markup appear.
  const [attempt, setAttempt] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  // A logo exists but its file would not load (CDN edge not warm yet, half-written upload, brief outage):
  // keep retrying quietly; the default logo is NEVER shown in its place.
  useEffect(() => {
    if (!imgFailed) return;
    const t = window.setTimeout(() => { setImgFailed(false); setAttempt((a) => a + 1); }, 8_000);
    return () => window.clearTimeout(t);
  }, [imgFailed]);

  const loadLogo = useCallback(() => {
    fetchBrandLogo().then((url) => {
      if (url === undefined) {
        // Unknown (offline/server hiccup): keep whatever is showing; fall back to the last known logo if any.
        setLogoUrl((cur) => (cur !== undefined ? cur : (readStored() ? resolveImageUrl(readStored() as string) : undefined)));
        return;
      }
      const next = url ? resolveImageUrl(url) : null;
      setLogoUrl((cur) => {
        if (cur !== next) { setImgFailed(false); setAttempt(0); }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    // First paint with nothing known: use the last logo this browser saw while the real answer loads.
    setLogoUrl((cur) => (cur === undefined && readStored() ? resolveImageUrl(readStored() as string) : cur));
    loadLogo();
    const onUpdated = () => loadLogo();
    window.addEventListener('site-brand-logo-updated', onUpdated);
    return () => window.removeEventListener('site-brand-logo-updated', onUpdated);
  }, [loadLogo]);
  useBrandLogoRevalidation(loadLogo);

  // Unknown: reserve the space invisibly so nothing jumps and the default logo never flashes.
  if (logoUrl === undefined) {
    return <span aria-hidden="true" style={{ visibility: 'hidden', display: 'inline-flex' }}>{fallback}</span>;
  }

  if (logoUrl && imgFailed) {
    return <span aria-hidden="true" style={{ visibility: 'hidden', display: 'inline-flex' }}>{fallback}</span>;
  }

  if (logoUrl) {
    const src = attempt > 0 ? `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}r=${attempt}` : logoUrl;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={src}
        src={src}
        alt={alt}
        className={imgClassName}
        style={{ height: imgHeight, width: 'auto', display: 'block' }}
        onError={() => { if (attempt < 2) setAttempt(attempt + 1); else setImgFailed(true); }}
      />
    );
  }

  return <>{fallback}</>;
}
