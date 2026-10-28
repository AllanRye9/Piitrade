'use client';

import { createContext, useContext, useEffect, useState } from 'react';
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

// Module-level cache/in-flight promise shared across every instance on the
// page (header + footer both check this) so we only ever fetch it once.
let cachedLogoUrl: string | null | undefined;
let inFlight: Promise<string | null> | null = null;
let logoFetchGeneration = 0;

export function fetchBrandLogo(): Promise<string | null> {
  if (cachedLogoUrl !== undefined) return Promise.resolve(cachedLogoUrl);
  if (inFlight) return inFlight;
  const generation = logoFetchGeneration;
  const request = api
    .get(`/site-media?section=brand-logo&_t=${Date.now()}`)
    .then(({ data }) => {
      const items = data?.media || [];
      const url: string | null = items[0]?.cdnUrl || null;
      if (generation === logoFetchGeneration) cachedLogoUrl = url;
      return url;
    })
    .catch(() => {
      if (generation === logoFetchGeneration) cachedLogoUrl = null;
      return null;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/**
 * First-paint value of the Site Logo, resolved on the server (app/layout.tsx) so the logo is already in the
 * HTML: no flash of the "Pi" / "Piitrade" fallback while the browser fetches it. A context (not a module
 * variable) so nothing leaks between requests on the server. `undefined` = not known, fetch on the client.
 */
const BrandLogoContext = createContext<string | null | undefined>(undefined);

export function BrandLogoProvider({ initialUrl, children }: { initialUrl: string | null; children: React.ReactNode }) {
  return <BrandLogoContext.Provider value={initialUrl}>{children}</BrandLogoContext.Provider>;
}

export function refreshBrandLogo() {
  logoFetchGeneration += 1;
  cachedLogoUrl = undefined;
  inFlight = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('site-brand-logo-updated'));
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
  // Holds the FINAL <img src>. The server-provided value is already browser-safe (lib/siteLogo.ts), so only
  // URLs fetched on the client go through resolveImageUrl (which would turn a path into the internal backend host on the server).
  const [logoUrl, setLogoUrl] = useState<string | null>(typeof cachedLogoUrl === 'string' ? resolveImageUrl(cachedLogoUrl) : (initial ?? null));
  // If the uploaded logo image 404s at runtime (e.g. it was stored on the
  // backend's local-disk fallback and lost on redeploy), drop back to the
  // text/markup fallback instead of showing a broken image in the header.
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let requestId = 0;
    const loadLogo = () => {
      const currentRequestId = ++requestId;
      setImgFailed(false);
      fetchBrandLogo().then((url) => {
        if (active && currentRequestId === requestId) setLogoUrl(url ? resolveImageUrl(url) : null);
      });
    };
    const handleLogoUpdate = () => loadLogo();
    loadLogo();
    window.addEventListener('site-brand-logo-updated', handleLogoUpdate);
    return () => {
      active = false;
      window.removeEventListener('site-brand-logo-updated', handleLogoUpdate);
    };
  }, []);

  if (logoUrl && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={alt}
        className={imgClassName}
        style={{ height: imgHeight, width: 'auto', display: 'block' }}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return <>{fallback}</>;
}
