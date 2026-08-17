'use client';

import { useCart } from '@/context/CartContext';
import { formatCurrency, resolveImageUrl } from '@/lib/utils';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Demo promo codes: in production these would be validated server-side
const PROMO_CODES: Record<string, { discount: number; label: string }> = {
  PIITRADE10: { discount: 0.1, label: '10% off' },
  SAVE5: { discount: 0.05, label: '5% off' },
};

export default function CartPage() {
  const { items, removeFromCart, updateQuantity, clearCart, totalItems, totalPrice, conversionInfo, clearConversionInfo } = useCart();
  const router = useRouter();
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{ discount: number; label: string; code: string } | null>(null);
  const [promoError, setPromoError] = useState('');

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
          className="px-8 py-3 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold transition-colors shadow-md"
        >
          Browse Listings
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
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
          Shopping Cart <span className="text-sky-500 text-lg font-semibold">({totalItems} {totalItems === 1 ? 'item' : 'items'})</span>
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

            return (
              <div key={listing.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-4">
                <Link href={`/listings/${listing.id}`} className="relative w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                  {img ? (
                    <Image src={resolveImageUrl(img)} alt={listing.title} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl">🏷️</div>
                  )}
                </Link>

                <div className="flex-1 min-w-0">
                  <Link href={`/listings/${listing.id}`} className="font-semibold text-gray-900 hover:text-sky-600 transition-colors line-clamp-2 text-sm">
                    {listing.title}
                  </Link>
                  <p className="text-xs text-gray-500 mt-0.5">{listing.condition} · {listing.location}</p>

                  {/* Variant selections — shown so the buyer can confirm before checkout */}
                  {(variants?.color || variants?.size || variants?.attributes) && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {variants.color && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2 py-0.5">
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
                        className="w-7 h-7 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center text-lg font-bold transition-colors"
                        aria-label="Increase quantity"
                      >+</button>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-bold text-sky-700 text-sm">{itemPrice}</span>
                      <button
                        onClick={() => removeFromCart(listing.id)}
                        className="text-red-400 hover:text-red-600 transition-colors"
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
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400"
                  aria-label="Promo code"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm rounded-xl transition-colors"
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
              <span className="text-xl font-bold text-sky-600">
                {formatCurrency(
                  appliedPromo ? totalPrice * (1 - appliedPromo.discount) : totalPrice,
                  'USD'
                )}
              </span>
            </div>
          </div>

          <button
            onClick={() => router.push('/checkout')}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold text-base transition-all shadow-md hover:shadow-lg mb-3"
          >
            Proceed to Checkout →
          </button>

          <Link
            href="/listings"
            className="block text-center mt-3 text-sm text-sky-600 hover:text-sky-800 font-medium transition-colors"
          >
            ← Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}
