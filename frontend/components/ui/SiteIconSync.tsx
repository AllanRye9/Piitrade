'use client';

import { useEffect } from 'react';
import { fetchBrandLogo } from '@/components/ui/BrandLogo';
import { resolveImageUrl } from '@/lib/utils';
import { BLANK_ICON } from '@/lib/siteLogo';

/**
 * Keeps the browser-tab icon (and the iOS home-screen icon) in step with the Site Logo; with no logo uploaded it shows nothing.
 * The server already renders the right <link rel="icon"> (app/layout.tsx → generateMetadata); this only
 * covers the gap after an admin uploads / replaces / removes the logo, so the tab updates immediately
 * instead of after the metadata cache. Renders nothing.
 */

function removeLinks(rel: string) {
  document.head.querySelectorAll(`link[rel="${rel}"]`).forEach((l) => l.remove());
}

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
    const apply = (url: string | null | undefined) => {
      // undefined = could not be determined: leave the icon the server rendered rather than reset it to the default.
      if (!active || url === undefined) return;
      // Uploaded logo → the tab shows only that logo. None uploaded → a transparent icon (nothing shown), never a built-in one.
      const href = url ? resolveImageUrl(url) : BLANK_ICON;
      const type = url ? undefined : 'image/png';
      setLink('icon', href, type);
      setLink('shortcut icon', href, type);
      if (url) setLink('apple-touch-icon', href);
      else removeLinks('apple-touch-icon');
    };
    const sync = () => { fetchBrandLogo().then(apply); };
    window.addEventListener('site-brand-logo-updated', sync);
    sync();
    // Another tab replaced the logo, or this tab regained focus.
    const onStorage = (e: StorageEvent) => { if (e.key === 'piitrade:brandLogoUpdatedAt') sync(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', sync);
    return () => {
      active = false;
      window.removeEventListener('site-brand-logo-updated', sync);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', sync);
    };
  }, []);
  return null;
}
