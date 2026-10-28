'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { API_URL } from '@/lib/apiUrl';

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
  /** CDN URL of the admin-uploaded "LIVE NOW / SHOP NOW" promo video shown
   *  beside the homepage hero slideshow. null = show a branded placeholder
   *  instead of a video. */
  promoVideoUrl: string | null;
  /** Countries shown in the storefront country switcher, welcome modal, and
   *  /country/* pages. Admin-configurable from /admin/settings — launch
   *  scope is Uganda-only; other countries stay hidden until enabled here.
   *  Always has at least one entry. */
  enabledCountries: string[];
  /** Master switch (admin/settings → Feature Settings) for the mobile
   *  "Special finds" popup. When false the popup never mounts at all.
   *  @deprecated superseded by `specialOffers.enabled` below — kept only
   *  for older code paths that may still read the bare boolean; new code
   *  should read `specialOffers`. */
  specialFindsEnabled: boolean;
  /** Admin-controlled "Special Offers" section (formerly "Special Finds").
   *  `enabled` already accounts for the section's optional scheduled
   *  window (startAt/endAt) — false whenever outside that window, so
   *  components don't need to re-check the dates themselves. Configured at
   *  /admin/settings → "Special Offers". */
  specialOffers: {
    enabled: boolean;
    minDiscountPercent: number;
    startAt: string | null;
    endAt: string | null;
  };
  /** Admin → Settings → General. */
  siteName: string;
  maintenanceMode: boolean;
  allowRegistration: boolean;
  maxImagesPerListing: number;
  itemsPerPage: number;
  /** Admin → Category layout: top-level category slugs in display order (may be partial). */
  categoryRank: string[];
  /** Admin → Category layout: top-level category slugs hidden from buyer surfaces. */
  hiddenCategories: string[];
}

const defaultConfig: SiteConfig = {
  whatsappNumber: null,
  todaysDeals: [],
  promoVideoUrl: null,
  enabledCountries: ['UGANDA'],
  specialFindsEnabled: true,
  specialOffers: { enabled: true, minDiscountPercent: 30, startAt: null, endAt: null },
  siteName: 'Piitrade',
  maintenanceMode: false,
  allowRegistration: true,
  maxImagesPerListing: 10,
  itemsPerPage: 20,
  categoryRank: [],
  hiddenCategories: [],
};

const SiteConfigContext = createContext<SiteConfig>(defaultConfig);

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SiteConfig>(defaultConfig);

  useEffect(() => {
    // Add a timestamp so the browser never serves a stale cached response —
    // the server-side endpoint shuffles deals randomly on every request.
    const url = `${API_URL}/api/public/site-config?_t=${Date.now()}`;
    fetch(url, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setConfig((prev) => ({
          ...prev,
          ...data,
          specialOffers: { ...prev.specialOffers, ...data.specialOffers },
        }));
      })
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
