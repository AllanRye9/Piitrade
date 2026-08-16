'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

/**
 * BrandLogo
 *
 * Renders the full "3R Elite" brand lockup — the icon box, the "3R Elite"
 * name, and the "Shop Smart. Shop Elite." tagline — as ONE unified image
 * whenever an admin has uploaded a logo via Site Media Manager →
 * "Header Logo / Tagline Image". When no logo has been uploaded, it falls
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

function fetchBrandLogo(): Promise<string | null> {
  if (cachedLogoUrl !== undefined) return Promise.resolve(cachedLogoUrl);
  if (inFlight) return inFlight;
  inFlight = api
    .get('/site-media?section=brand-logo')
    .then(({ data }) => {
      const items = data?.media || [];
      const url: string | null = items[0]?.cdnUrl || null;
      cachedLogoUrl = url;
      return url;
    })
    .catch(() => {
      cachedLogoUrl = null;
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

interface BrandLogoProps {
  /** Original icon + "3R Elite" + tagline markup, shown until/unless a logo image exists. */
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
  alt = '3R Elite — Shop Smart. Shop Elite.',
}: BrandLogoProps) {
  const [logoUrl, setLogoUrl] = useState<string | null>(typeof cachedLogoUrl === 'string' ? cachedLogoUrl : null);

  useEffect(() => {
    let active = true;
    fetchBrandLogo().then((url) => {
      if (active && url) setLogoUrl(url);
    });
    return () => {
      active = false;
    };
  }, []);

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolveImageUrl(logoUrl)}
        alt={alt}
        className={imgClassName}
        style={{ height: imgHeight, width: 'auto', display: 'block' }}
      />
    );
  }

  return <>{fallback}</>;
}
