'use client';

import { useCart } from '@/context/CartContext';
import { formatCurrency, resolveImageUrl } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import ContactSellerModal from '@/components/ui/ContactSellerModal';

// Demo promo codes: in production these would be validated server-side
const PROMO_CODES: Record<string, { discount: number; label: string }> = {
  PIITRADE10: { discount: 0.1, label: '10% off' },
  SAVE5: { discount: 0.05, label: '5% off' },
};

export default function CartPage() {
  const { items, removeFromCart, updateQuantity, clearCart, totalItems, totalPrice, conversionInfo, clearConversionInfo } = useCart();
  const { user } = useAuth();
  const router = useRouter();
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{ discount: number; label: string; code: string } | null>(null);
  const [promoError, setPromoError] = useState('');
  const [contactModalOpen, setContactModalOpen] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  // Card/bank checkout is admin-only (see /checkout). Everyone else gets
  // put in touch with each distinct seller in their cart instead of an
  // online payment step — a cart can hold items from several sellers, so
  // this is a list rather than the single-seller popup the listing page
  // uses for "Buy Now".
  const sellerContacts = Array.from(
    new Map(items.map((it) => [it.listing.user.id, it])).values()
  ).map((it) => ({
    sellerName: it.listing.user.name,
    phone: it.listing.user.phone,
    whatsapp: it.listing.user.socialLinks?.whatsapp,
    listingTitle: it.listing.title,
  }));

  const handleCheckoutClick = () => {
    if (!isAdmin) { setContactModalOpen(true); return; }
    router.push('/checkout');
  };

  const handleApplyPromo = (e: React.FormEvent) => {
    e.preventDefault();
    setPromoError('');
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    const promo = PROMO_CODES[code];
    if (promo) {
      setAppliedPromo({ ...promo, code });
    } else {
      setAppliedPromo(null);
      setPromoError('Invalid promo code. Try PIITRADE10 for 10% off.');
    }
  };

  const unavailableReason = (listing: { status: string; stock?: number }) => {
    const outOfStock = typeof listing.stock === 'number' && listing.stock <= 0;
    if (listing.status !== 'ACTIVE' && !outOfStock) {
      return listing.status === 'SOLD' ? 'Already sold'
        : listing.status === 'EXPIRED' ? 'Listing expired'
        : listing.status === 'HIDDEN' || listing.status === 'REJECTED' ? 'No longer available'
        : listing.status === 'PENDING' ? 'Pending approval'
        : 'Unavailable';
    }
    if (outOfStock) return 'Out of stock';
    return null;
  };

  const hasUnavailableItems = items.some(({ listing }) => !!unavailableReason(listing));

  if (items.length === 0) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center px-4 py-8">
        <div className="text-7xl mb-6">🛒</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Your cart is empty</h1>
        <p className="text-gray-500 mb-4 text-center max-w-md">
          Looks like you haven&apos;t added any items yet. Browse our listings to find something you love.
        </p>
        <Link
          href="/listings"
          className="px-8 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors shadow-md"
        >
          Browse Listings
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-4 pb-28 lg:pb-4">
      {conversionInfo && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 flex items-center justify-between">
          <div className="text-sm">
            Cart prices converted from {conversionInfo.from} to {conversionInfo.to}.
          </div>
          <button onClick={clearConversionInfo} className="text-xs text-amber-700 font-semibold">Dismiss</button>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Shopping Cart <span className="text-red-500 text-lg font-semibold">({totalItems} {totalItems === 1 ? 'item' : 'items'})</span>
        </h1>
        <button
          onClick={clearCart}
          className="text-sm text-red-500 hover:text-red-700 font-medium transition-colors"
        >
          Clear cart
        </button>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Cart items */}
        <div className="space-y-4">
          {items.map(({ listing, quantity, variants }) => {
            const img = listing.productImages?.[0]?.cdnUrl ?? listing.images?.[0] ?? null;
            const itemPrice = formatCurrency(listing.price * quantity, listing.currency);
            const unavailable = unavailableReason(listing);

            return (
              <div key={listing.id} className={`bg-white rounded-2xl border shadow-sm p-4 flex gap-4 ${unavailable ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
                <Link href={`/listings/${listing.id}`} className="relative w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                  {img ? (
                    <Image src={resolveImageUrl(img)} alt={listing.title} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl">🏷️</div>
                  )}
                </Link>

                <div className="flex-1 min-w-0">
                  <Link href={`/listings/${listing.id}`} className="font-semibold text-gray-900 hover:text-red-600 transition-colors line-clamp-2 text-sm">
                    {listing.title}
                  </Link>
                  <p className="text-xs text-gray-500 mt-0.5">{listing.condition} · {listing.location}</p>
                  {unavailable && (
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5">
                      ⚠ {unavailable} — remove to continue checkout
                    </span>
                  )}

                  {/* Variant selections — shown so the buyer can confirm before checkout */}
                  {(variants?.color || variants?.size || variants?.attributes) && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {variants.color && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                          🎨 {variants.color}
                        </span>
                      )}
                      {variants.size && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
                          📐 {variants.size}
                        </span>
                      )}
                      {variants.attributes && Object.entries(variants.attributes).map(([k, v]) => v ? (
                        <span key={k} className="inline-flex items-center gap-1 text-[10px] font-semibold bg-gray-50 text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">
                          {k}: {v}
                        </span>
                      ) : null)}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(listing.id, quantity - 1)}
                        className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center text-lg font-bold transition-colors"
                        aria-label="Decrease quantity"
                      >−</button>
                      <span className="w-8 text-center font-semibold text-gray-900">{quantity}</span>
                      <button
                        onClick={() => updateQuantity(listing.id, quantity + 1)}
                        disabled={!!unavailable}
                        className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center text-lg font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        aria-label="Increase quantity"
                      >+</button>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-bold text-red-700 text-sm">{itemPrice}</span>
                      <button
                        onClick={() => removeFromCart(listing.id)}
                        className="text-red-400 hover:text-red-600 transition-colors p-1.5 -m-1.5"
                        aria-label="Remove item"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Order summary */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 h-fit sticky top-24">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>

          <div className="space-y-3 mb-4">
            {items.map(({ listing, quantity }) => (
              <div key={listing.id} className="flex justify-between text-sm">
                <span className="text-gray-600 line-clamp-1 flex-1 mr-2">{listing.title} ×{quantity}</span>
                <span className="font-medium text-gray-900 whitespace-nowrap">
                  {formatCurrency(listing.price * quantity, listing.currency)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-4 mb-4">
            {/* Promo code */}
            <form onSubmit={handleApplyPromo} className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Promo Code</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => { setPromoCode(e.target.value); setPromoError(''); setAppliedPromo(null); }}
                  placeholder="Enter code"
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
                  aria-label="Promo code"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-semibold text-sm rounded-xl transition-colors"
                >
                  Apply
                </button>
              </div>
              {appliedPromo && (
                <p className="mt-1.5 text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <span>✓</span> {appliedPromo.code} applied – {appliedPromo.label}!
                </p>
              )}
              {promoError && (
                <p className="mt-1.5 text-xs text-red-500">{promoError}</p>
              )}
            </form>

            <div className="space-y-1.5 text-sm mb-3">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                  <span>{formatCurrency(totalPrice, 'USD')}</span>
              </div>
              {appliedPromo && (
                <div className="flex justify-between text-emerald-600 font-medium">
                  <span>Discount ({appliedPromo.label})</span>
                    <span>−{formatCurrency(totalPrice * appliedPromo.discount, 'USD')}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-500 text-xs">
                <span>Shipping &amp; taxes</span>
                <span>Calculated at checkout</span>
              </div>
            </div>

            <div className="flex justify-between items-center border-t border-gray-100 pt-3">
              <span className="font-bold text-gray-900">Total</span>
              <span className="text-xl font-bold text-red-600">
                {formatCurrency(
                  appliedPromo ? totalPrice * (1 - appliedPromo.discount) : totalPrice,
                  'USD'
                )}
              </span>
            </div>
          </div>

          {hasUnavailableItems && (
            <p className="mb-3 text-xs font-medium text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              Remove the unavailable item(s) above before checking out.
            </p>
          )}
          <button
            onClick={handleCheckoutClick}
            disabled={hasUnavailableItems}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold text-base transition-all shadow-md hover:shadow-lg mb-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-red-500 disabled:hover:to-red-600"
          >
            Proceed to Checkout →
          </button>

          <Link
            href="/listings"
            className="block text-center mt-3 text-sm text-red-600 hover:text-red-800 font-medium transition-colors"
          >
            ← Continue Shopping
          </Link>
        </div>
      </div>

      {/* Persistent checkout bar — mirrors the reference mobile layout's
          "Add X to place your order" bottom bar: total + a one-thumb-reach
          checkout button that stays visible while scrolling through a long
          cart, instead of making the buyer scroll all the way down to the
          Order Summary card to check out. Sits above MobileBottomNav
          (which is 64px tall, fixed bottom-0, and hidden at md: and up) on
          phones, and flush with the viewport bottom on tablet where the
          bottom nav is already gone. Hidden once the sidebar summary is
          showing at lg:, since its own checkout button is already always
          on-screen there. */}
      <div
        className="lg:hidden fixed inset-x-0 bottom-16 md:bottom-0 z-40 bg-white border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-4 py-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500 leading-none mb-0.5">
              {totalItems} {totalItems === 1 ? 'item' : 'items'}
            </p>
            <p className="text-lg font-bold text-red-600 leading-none truncate">
              {formatCurrency(appliedPromo ? totalPrice * (1 - appliedPromo.discount) : totalPrice, 'USD')}
            </p>
          </div>
          <button
            onClick={handleCheckoutClick}
            disabled={hasUnavailableItems}
            className="shrink-0 py-3 px-6 rounded-xl bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold text-sm shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-red-500 disabled:hover:to-red-600"
          >
            {hasUnavailableItems ? 'Remove unavailable' : 'Checkout →'}
          </button>
        </div>
      </div>

      <ContactSellerModal
        open={contactModalOpen}
        onClose={() => setContactModalOpen(false)}
        contacts={sellerContacts}
        heading={sellerContacts.length > 1 ? 'Contact Your Sellers' : 'Contact the Seller'}
      />
    </div>
  );
}
