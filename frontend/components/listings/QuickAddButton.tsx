'use client';

import { useCallback } from 'react';
import { useCart } from '@/context/CartContext';
import { useSiteConfig } from '@/context/SiteConfigContext';
import { useToast } from '@/components/ui/Toast';
import { isCheckoutEligible } from '@/lib/utils';
import type { Listing } from '@/lib/types';

interface Props {
  listing: Listing;
  /** Slightly smaller footprint when used inside compact cards (e.g. the mobile deals popup) */
  size?: 'sm' | 'md';
  /**
   * 'overlay' (default) — floating white/red circle docked in the image's
   * top-right corner, used by the deal-rail style cards (FlashDeals,
   * FeaturedProductCard, BackToSchoolSection, MobileSpecialOffersPopup).
   * 'inline' — solid site-red circle meant to sit next to the price row in
   * ListingCard: it toasts a confirmation and then hides itself once the
   * item is added, rather than staying on-card as a persistent toggle.
   */
  variant?: 'overlay' | 'inline';
}

/**
 * "+" button for adding a listing to the cart directly from a listing card,
 * without navigating to the listing detail page.
 *
 * The button reflects the listing's live availability rather than being
 * permanently disabled after the first click: SOLD/EXPIRED/HIDDEN/REJECTED
 * listings and listings with zero tracked stock render a disabled
 * "unavailable" state instead of an actionable "+".
 */
export function QuickAddButton({ listing, size = 'md', variant = 'overlay' }: Props) {
  const { items, addToCart } = useCart();
  const { marketplaceMode } = useSiteConfig();
  const { success } = useToast();

  const cartItem = items.find((i) => i.listing.id === listing.id);
  const quantity = cartItem?.quantity ?? 0;
  const alreadyInCart = quantity > 0;

  // Unavailable: not currently purchasable. Stock is only enforced when the
  // listing tracks it (stock === undefined means the seller isn't tracking
  // inventory for this item, so it stays available on status alone).
  const outOfStock = typeof listing.stock === 'number' && listing.stock <= 0;
  const unavailable = listing.status !== 'ACTIVE' || outOfStock;
  const unavailableReason =
    listing.status === 'SOLD' ? 'Already sold'
    : listing.status === 'EXPIRED' ? 'Listing expired'
    : listing.status === 'HIDDEN' || listing.status === 'REJECTED' ? 'No longer available'
    : listing.status === 'PENDING' ? 'Pending approval'
    : outOfStock ? 'Out of stock'
    : 'Unavailable';

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (unavailable) return;
      addToCart(listing);
      if (variant === 'inline') success(`Added "${listing.title}" to cart`);
    },
    [addToCart, listing, unavailable, variant, success]
  );

  // Contact-only listings (Motors/Property always, or anything the site's
  // current Classifieds/E-commerce/Hybrid mode excludes — see
  // isCheckoutEligible in lib/utils.ts) never get a quick-add control at
  // all, on any card this button appears on. This was a real, pre-existing
  // gap: this component only ever checked stock/status above, so a Motors
  // or Property listing could be added straight to cart from its card
  // despite the listing detail page and ContactSellerModal treating it as
  // contact-only everywhere else — the two surfaces disagreed with each
  // other. POST /api/orders still enforces this server-side regardless, so
  // this isn't the only guard, just the one that stops it from ever
  // reaching the cart in the first place. Placed after every hook above
  // (not as the first line of the component) so the hook call order never
  // changes between renders as marketplaceMode loads in asynchronously.
  if (!isCheckoutEligible(listing, marketplaceMode)) return null;

  // 'inline' next to the price: once it's in the cart there's nothing more
  // for this control to do here (the cart drawer/page is the place to
  // adjust quantity), so it hides itself entirely rather than sitting there
  // as a stale checkmark — the toast already confirmed the add.
  if (variant === 'inline' && alreadyInCart && !unavailable) return null;

  const dims = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7 xs:w-8 xs:h-8';
  const iconDims = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5 xs:w-4 xs:h-4';
  const qtyTextDims = size === 'sm' ? 'text-[11px]' : 'text-xs';

  if (variant === 'inline') {
    const inlineDims = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
    const inlineIconDims = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
    return (
      <button
        type="button"
        onClick={handleAdd}
        disabled={unavailable}
        aria-label={unavailable ? unavailableReason : 'Add to cart'}
        title={unavailable ? unavailableReason : 'Add to cart'}
        className={`${inlineDims} shrink-0 rounded-full flex items-center justify-center shadow-sm transition-colors ${
          unavailable
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-red-600 text-white hover:bg-red-700 active:scale-95'
        }`}
      >
        {unavailable ? (
          <svg className={inlineIconDims} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className={inlineIconDims} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>
    );
  }

  // 'overlay' (grid-card corner button): mirrors the reference mobile
  // grocery-app pattern — an empty white "+" circle before anything's in
  // the cart, and once it is, a solid brand-colored circle showing the
  // live quantity instead of a separate static checkmark badge. Tapping it
  // again keeps incrementing (addToCart already merges into the existing
  // cart line), so it doubles as a lightweight stepper without needing the
  // full −/qty/+ control that only really fits on the cart page itself.
  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={unavailable}
      aria-label={unavailable ? unavailableReason : alreadyInCart ? `${quantity} in cart, tap to add another` : 'Add to cart'}
      title={unavailable ? unavailableReason : alreadyInCart ? `${quantity} in cart` : 'Add to cart'}
      className={`${dims} rounded-full flex items-center justify-center shadow-md transition-transform active:scale-90 ${
        unavailable
          ? 'bg-gray-200 text-gray-400 border border-gray-200 cursor-not-allowed'
          : alreadyInCart
          ? 'bg-red-600 text-white'
          : 'bg-white text-red-600 border border-white hover:bg-red-500 hover:text-white'
      }`}
    >
      {unavailable ? (
        <svg className={iconDims} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      ) : alreadyInCart ? (
        <span className={`${qtyTextDims} font-extrabold leading-none tabular-nums`}>{quantity}</span>
      ) : (
        <svg className={iconDims} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      )}
    </button>
  );
}

