'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

/**
 * BrandTagline
 *
 * Renders the "Shop Smart. Shop Elite." tagline that sits under the 3R Elite
 * logo in the header, footer, and welcome popup. If an admin has uploaded an
 * image via Site Media Manager → "Header Logo / Tagline Image", that image
 * is shown instead, sized to fit the exact same slot the text used to occupy.
 * Falls back to the original text whenever no image has been uploaded.
 */

// Module-level cache so every instance on the page (header, footer, modal)
// shares one fetch instead of each firing its own request.
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

interface BrandTaglineProps {
  /** Classes applied to the fallback text (used only when no logo image exists). */
  className?: string;
  /** Classes applied to the <img> when a logo image exists. */
  imgClassName?: string;
  /** Height in px for the rendered logo image, so it fits the same slot as the text. */
  imgHeight?: number;
}

export default function BrandTagline({ className = '', imgClassName = '', imgHeight = 14 }: BrandTaglineProps) {
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
        alt="Shop Smart. Shop Elite."
        className={imgClassName}
        style={{ height: imgHeight, width: 'auto', display: 'block' }}
      />
    );
  }

  return <span className={className}>Shop Smart. Shop Elite.</span>;
}
