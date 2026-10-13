import { clsx, type ClassValue } from 'clsx';
import type { Country, Currency, Listing } from '@/lib/types';
import { API_URL } from '@/lib/apiUrl';

// ─── Checkout eligibility ───────────────────────────────────────────────────
// Card/Bank were removed as buyer-facing payment methods. What's left
// (Mobile Money / Cash on Delivery) is only usable when Piitrade itself is
// the seller — i.e. the listing was posted by an ADMIN account — since
// that's the only case where there's an actual party on the other end able
// to process and fulfil an online payment. Ordinary users' listings never
// get this, regardless of who's buying: the buyer is put in touch with the
// seller directly (Call/Chat) instead. Motors and Property are a further,
// unconditional exception — big-ticket, negotiated purchases go straight to
// Call/Chat even when Piitrade/an admin is the seller, so they're excluded
// here regardless of the seller's role.
//
// This one function is the single source of truth for that rule — used by
// the listing detail page's "Buy Now", the cart's "Proceed to Checkout",
// and /checkout's own defensive re-check — so the three can't drift apart.
export function getListingTopCategorySlug(listing: Listing): string | undefined {
  return listing.category?.parent?.slug || listing.category?.slug;
}

export function isDirectContactCategory(listing: Listing): boolean {
  const slug = getListingTopCategorySlug(listing);
  return slug === 'motors' || slug === 'property';
}

export type MarketplaceMode = 'CLASSIFIEDS' | 'ECOMMERCE' | 'HYBRID';

/**
 * Whether a listing gets Buy Now/cart (vs. contact-the-seller-only) — the
 * single function the whole frontend reads this through, and the exact
 * logic POST /api/orders enforces server-side too (see its own comment in
 * backend/src/routes/orders.ts; that's the real guarantee, this is what
 * drives the UI to match it).
 *
 * `marketplaceMode` defaults to 'HYBRID' — the only behavior that existed
 * before this was configurable (hard-coded as `role === 'ADMIN'`) — so any
 * call site that doesn't pass it keeps behaving exactly as before. Pass
 * `useSiteConfig().marketplaceMode` wherever the real current mode matters
 * (cart, checkout, the listing detail page's Buy Now button).
 *
 *   CLASSIFIEDS — nobody gets Buy Now/cart.
 *   ECOMMERCE   — everyone outside Motors/Property gets Buy Now/cart.
 *   HYBRID      — only admin-owned listings get Buy Now/cart.
 * Motors/Property stay contact-only in every mode — a car or a house isn't
 * an instant-cart purchase regardless of who's selling it.
 */
export function isCheckoutEligible(listing: Listing, marketplaceMode: MarketplaceMode = 'HYBRID'): boolean {
  if (isDirectContactCategory(listing)) return false;
  if (marketplaceMode === 'CLASSIFIEDS') return false;
  if (marketplaceMode === 'ECOMMERCE') return true;
  // HYBRID: only Piitrade itself and web stores (an active store rental) have
  // checkout; every other seller is contact/chat only. Mirrors the backend rule
  // in backend/src/utils/checkoutPolicy.ts, which is the actual gate.
  return listing.user?.role === 'ADMIN' || listing.user?.hasActiveStore === true;
}

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Extracts a real, specific error message from a failed axios request —
 * the backend's `errorHandler` already returns distinct messages for
 * different failure modes (e.g. "Database schema is not ready" for a
 * missing table, "Unable to connect to the database" for a connection
 * failure, or an auth message for an expired session) via `{ message }`
 * in the response body. Falls back to a generic message only when no
 * response was received at all (e.g. a genuine network/CORS failure) or
 * the body didn't include one.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const withResponse = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const backendMessage = withResponse.response?.data?.message;
    const status = withResponse.response?.status;
    if (backendMessage) return status ? `${backendMessage} (HTTP ${status})` : backendMessage;
    if (status) return `${fallback} (HTTP ${status})`;
    if (withResponse.message) return `${fallback} — ${withResponse.message}`;
  }
  return fallback;
}

/**
 * Resolves a backend image URL that may contain a localhost origin.
 * In production the backend stores absolute URLs using API_BASE_URL.
 * If that env var was not set, the stored URL will contain "localhost"
 * which is unreachable from the browser. We rewrite those URLs to use
 * the public NEXT_PUBLIC_API_URL instead.
 */
/**
 * Normalizes a user-pasted social/website link that may be missing its
 * scheme (e.g. "wa.me/256700000000", "facebook.com/mystore") into a
 * clickable absolute URL. Leaves already-absolute URLs untouched.
 */
export function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function resolveImageUrl(url: string): string {
  if (!url) return '';
  // API_URL (from lib/apiUrl.ts) is the single source of truth for the
  // backend base URL and — unlike a local `process.env.NEXT_PUBLIC_API_URL
  // || ''` fallback — is never empty: it degrades to a same-context-aware
  // default (the Docker service name server-side, localhost client-side)
  // instead of silently leaving image paths relative and unresolved.
  const apiBase = API_URL;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;

  // Re-write backend-origin absolute URLs that were saved before a deploy/domain
  // change (for example a Railway backend URL or localhost URL). These URLs are
  // still valid if they point at the same backend, but after a reassignment they
  // often become stale and start returning 404s from an old service instance.
  try {
    const parsed = new URL(url);
    const pathPart = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const backendPath = pathPart.startsWith('/api/') || pathPart.startsWith('/uploads/') || pathPart.startsWith('/media/');
    const backendHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      || parsed.hostname.includes('railway.app')
      || parsed.hostname.includes('render.com')
      || parsed.hostname.includes('vercel.app');

    if (backendPath && backendHost && apiBase) {
      return `${apiBase}${pathPart}`;
    }
  } catch {
    // Fallback to the regular relative/absolute handling below.
  }

  if (url.startsWith('http://localhost:') || url.startsWith('https://localhost:')) {
    const slashIdx = url.indexOf('/', url.indexOf('://') + 3);
    if (slashIdx === -1) return url;
    const pathPart = url.substring(slashIdx);
    return apiBase ? `${apiBase}${pathPart}` : pathPart;
  }

  // Rewrite relative API/upload paths to use the backend base URL.
  if ((url.startsWith('/api/') || url.startsWith('/uploads/') || url.startsWith('/media/')) && apiBase) {
    return `${apiBase}${url}`;
  }

  // Rewrite any other relative path into an absolute backend URL.
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const normalized = url.startsWith('/') ? url : `/${url}`;
    return apiBase ? `${apiBase}${normalized}` : normalized;
  }

  return url;
}

export function formatCurrency(amount: number, _currency?: Currency): string {
  return `UGX ${Math.round(amount).toLocaleString('en-UG')}`;
}

function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// Country-aware price ranges for filters (Motors, Property, etc.)
// Values are in the local currency of each country.
export interface PriceRange { label: string; min: string; max: string; }

export function getCountryPriceRanges(_country?: string): PriceRange[] {
  return [
    { label: 'Any Price',      min: '',           max: ''          },
    { label: 'Under UGX 18M',  min: '',           max: '18000000'  },
    { label: 'UGX 18M-55M',    min: '18000000',   max: '55000000'  },
    { label: 'UGX 55M-110M',   min: '55000000',   max: '110000000' },
    { label: 'UGX 110M-220M',  min: '110000000',  max: '220000000' },
    { label: 'Over UGX 220M',  min: '220000000',  max: ''          },
  ];
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function timeAgo(date: string | Date): string {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
}

export const UGANDA_LOCATIONS = [
  'Kampala', 'Jinja', 'Gulu', 'Mbarara', 'Masaka',
  'Entebbe', 'Lira', 'Mbale', 'Mukono', 'Soroti',
];

export function getLocations(_country?: Country): string[] {
  return UGANDA_LOCATIONS;
}

export function getCurrency(_country?: Country): Currency {
  return 'UGX';
}

/** UGX is the only currency, so conversion is the identity. Kept so existing call sites keep working. */
export function convertCurrency(amount: number, _from?: string, _to?: string): number {
  return amount;
}

// ─── Wholesale ordering (Agriculture): minimum order quantity + volume tiers ──
export interface PriceTier { minQty: number; price: number }

type QuantityPricedListing = {
  price: number;
  minOrderQuantity?: number | null;
  priceTiers?: PriceTier[] | null;
};

/** Smallest quantity a buyer may order (1 when the listing has no minimum). */
export function minOrderQty(listing: Pick<QuantityPricedListing, 'minOrderQuantity'>): number {
  return Math.max(1, listing.minOrderQuantity ?? 1);
}

/** Per-unit price that applies to an order of `qty` — mirrors the server's rule. */
export function unitPriceFor(listing: Pick<QuantityPricedListing, 'price' | 'priceTiers'>, qty: number): number {
  let price = listing.price;
  for (const tier of [...(listing.priceTiers ?? [])].sort((a, b) => a.minQty - b.minQty)) {
    if (qty >= tier.minQty) price = tier.price;
  }
  return price;
}

/** Line total for `qty` units, applying volume pricing. */
export function lineTotal(listing: Pick<QuantityPricedListing, 'price' | 'priceTiers'>, qty: number): number {
  return unitPriceFor(listing, qty) * qty;
}

/** "item" | "kg" | "tonne" — for "Min. order 50 kg" style copy. */
export function priceUnitWord(unit?: 'ITEM' | 'KG' | 'TONNE' | null): string {
  return unit === 'KG' ? 'kg' : unit === 'TONNE' ? 'tonne' : 'item';
}
