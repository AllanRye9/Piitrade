'use client';

import { useEffect } from 'react';
import { fetchBrandLogo } from '@/components/ui/BrandLogo';
import { resolveImageUrl } from '@/lib/utils';

/**
 * Keeps the browser-tab icon (and the iOS home-screen icon) in step with the Site Logo.
 * The server already renders the right <link rel="icon"> (app/layout.tsx → generateMetadata); this only
 * covers the gap after an admin uploads / replaces / removes the logo, so the tab updates immediately
 * instead of after the 60 s metadata cache. Renders nothing.
 */
const DEFAULT_ICON = '/icon.svg';

function setLink(rel: string, href: string, type?: string) {
  const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`));
  if (links.length === 0) {
    const l = document.createElement('link');
    l.rel = rel;
    document.head.appendChild(l);
    links.push(l);
  }
  for (const l of links) {
    l.href = href;
    l.removeAttribute('sizes');
    if (type) l.type = type; else l.removeAttribute('type');
  }
}

export default function SiteIconSync() {
  useEffect(() => {
    let active = true;
    const apply = (url: string | null) => {
      if (!active) return;
      const href = url ? resolveImageUrl(url) : DEFAULT_ICON;
      const type = url ? undefined : 'image/svg+xml';
      setLink('icon', href, type);
      setLink('shortcut icon', href, type);
      setLink('apple-touch-icon', url ? href : '/apple-touch-icon.svg', type);
    };
    const sync = () => { fetchBrandLogo().then(apply); };
    window.addEventListener('site-brand-logo-updated', sync);
    sync();
    return () => {
      active = false;
      window.removeEventListener('site-brand-logo-updated', sync);
    };
  }, []);
  return null;
}
