'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface Deal {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  originalPrice?: number;
  discount?: number;
  link?: string;
  currency?: string;
  expiresAt?: string | null; // ISO date or null = unlimited
  /**
   * Countries this deal should be visible in. undefined/empty = visible
   * everywhere. Previously visibility was (incorrectly) inferred from the
   * `currency` field, which meant a deal saved with the default currency
   * 'AED' silently never appeared for Uganda/Kenya/China visitors — looking
   * to the admin like the deal simply "didn't save". Country is now tracked
   * explicitly and independently of currency (which remains purely a price
   * display field).
   */
  countries?: string[];
}

interface SiteConfig {
  whatsappNumber: string | null;
  todaysDeals: Deal[];
  headerTheme: string | null;
  logoUrl: string | null;
  logoPages: string[];
  logoAltText: string | null;
  logoSize: number;
  logoLinkUrl: string | null;
  /** "inline" = logo next to the "PIITRADE EXCHANGE · Money Transfer Rates" text (default).
   *  "replace" = the image replaces that text section entirely. */
  logoDisplayMode: 'inline' | 'replace';
  /** CDN URL of the admin-uploaded "LIVE NOW / SHOP NOW" promo video shown
   *  beside the homepage hero slideshow. null = show a branded placeholder
   *  instead of a video. */
  promoVideoUrl: string | null;
  /** Countries shown in the storefront country switcher, welcome modal, and
   *  /country/* pages. Admin-configurable from /admin/settings — launch
   *  scope is Uganda-only; other countries stay hidden until enabled here.
   *  Always has at least one entry. */
  enabledCountries: string[];
}

const defaultConfig: SiteConfig = {
  whatsappNumber: null,
  todaysDeals: [],
  headerTheme: null,
  logoUrl: null,
  logoPages: [],
  logoAltText: null,
  logoSize: 28,
  logoLinkUrl: null,
  logoDisplayMode: 'inline',
  promoVideoUrl: null,
  enabledCountries: ['UGANDA'],
};

const SiteConfigContext = createContext<SiteConfig>(defaultConfig);

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SiteConfig>(defaultConfig);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
    // Add a timestamp so the browser never serves a stale cached response —
    // the server-side endpoint shuffles deals randomly on every request.
    const url = `${apiBase}/api/public/site-config?_t=${Date.now()}`;
    fetch(url, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setConfig((prev) => ({ ...prev, ...data })); })
      .catch(() => { /* fall back to defaults */ });
  }, []);

  return (
    <SiteConfigContext.Provider value={config}>
      {children}
    </SiteConfigContext.Provider>
  );
}

export function useSiteConfig() {
  return useContext(SiteConfigContext);
}
