'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Listing, Currency } from '@/lib/types';
import { convertCurrency } from '@/lib/utils';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';

export interface CartItemVariants {
  /** Selected colour option, e.g. "Black" */
  color?:     string;
  /** Selected size option, e.g. "M" */
  size?:      string;
  /** Any additional listing-specific attributes (key → value) */
  attributes?: Record<string, string>;
}

export interface CartItem {
  listing:   Listing;
  quantity:  number;
  /** Variant / option selections the buyer made on the listing detail page */
  variants?: CartItemVariants;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (listing: Listing, variants?: CartItemVariants) => void;
  removeFromCart: (listingId: string) => void;
  updateQuantity: (listingId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  conversionInfo: { from: Currency; to: Currency; at: number; auto?: boolean } | null;
  clearConversionInfo: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const { currency: selectedCurrency, lastSelection } = useCountry();
  const [conversionInfo, setConversionInfo] = useState<{ from: Currency; to: Currency; at: number; auto?: boolean } | null>(null);

  // Kept in sync with `items` on every render so the focus-reconciliation
  // effect below can always read the latest cart contents without having
  // to re-subscribe every time items changes.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Checks every cart line against the listing's *current* status/stock and
  // reconciles the cart accordingly: a listing removed by an admin (hard
  // delete) is dropped from the cart entirely; a listing that's since been
  // sold, deactivated/expired, or gone out of stock has its stored
  // status/stock refreshed so the cart UI can show it as unavailable — the
  // cart previously never re-checked a listing after the initial add, so
  // any of those changes happening later went unnoticed indefinitely.
  const reconcile = useCallback(async (current: CartItem[]) => {
    const ids = current.map((i) => i.listing.id);
    if (ids.length === 0) return;
    try {
      const { data } = await api.get('/listings/status', { params: { ids: ids.join(',') } });
      const statusMap = new Map<string, { status: Listing['status']; stock: number }>(
        (data.listings || []).map((l: { id: string; status: Listing['status']; stock: number }) => [l.id, { status: l.status, stock: l.stock }])
      );
      setItems((prev) => {
        let changed = false;
        const next: CartItem[] = [];
        for (const item of prev) {
          const fresh = statusMap.get(item.listing.id);
          if (!fresh) {
            // No longer in the database at all — the admin deleted it.
            changed = true;
            continue;
          }
          if (fresh.status !== item.listing.status || fresh.stock !== item.listing.stock) {
            changed = true;
            next.push({ ...item, listing: { ...item.listing, status: fresh.status, stock: fresh.stock } });
          } else {
            next.push(item);
          }
        }
        if (!changed) return prev;
        try { localStorage.setItem('cart', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    } catch {
      // Best-effort — e.g. offline. Leave the cart exactly as it was;
      // we'll try again next time the tab regains focus.
    }
  }, []);

  useEffect(() => {
    let loaded: CartItem[] = [];
    try {
      const saved = localStorage.getItem('cart');
      if (saved) loaded = JSON.parse(saved);
    } catch {
      // ignore malformed data
    }
    if (loaded.length > 0) {
      setItems(loaded);
      reconcile(loaded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check availability whenever the tab regains focus, so a listing
  // that was sold/deleted/deactivated in another tab (or by someone else)
  // while this tab was in the background is caught the next time the
  // shopper looks at it, not just on a full page reload.
  useEffect(() => {
    const onFocus = () => reconcile(itemsRef.current);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reconcile]);

  const persist = useCallback((next: CartItem[]) => {
    setItems(next);
    localStorage.setItem('cart', JSON.stringify(next));
  }, []);

  const addToCart = useCallback((listing: Listing, variants?: CartItemVariants) => {
    setItems((prev) => {
      // Ensure the listing stored in cart uses the currently selected currency
      const listingToStore = listing.currency === selectedCurrency
        ? listing
        : { ...listing, price: convertCurrency(listing.price, listing.currency, selectedCurrency), currency: selectedCurrency };

      // If we converted the listing on add, record conversion info
      if (listing.currency !== selectedCurrency) {
        setConversionInfo({ from: listing.currency, to: selectedCurrency, at: Date.now(), auto: lastSelection === 'auto' });
      }

      // Match on listing id + variant fingerprint so the same item with
      // different options creates separate cart lines (proper logistics)
      const variantKey = variants
        ? JSON.stringify({ color: variants.color, size: variants.size, ...variants.attributes })
        : '';

      const existing = prev.find(
        (i) => i.listing.id === listingToStore.id &&
               JSON.stringify({ color: i.variants?.color, size: i.variants?.size, ...i.variants?.attributes }) === variantKey
      );

      const next = existing
        ? prev.map((i) =>
            i.listing.id === listingToStore.id &&
            JSON.stringify({ color: i.variants?.color, size: i.variants?.size, ...i.variants?.attributes }) === variantKey
              ? { ...i, quantity: i.quantity + 1 }
              : i
          )
        : [...prev, { listing: listingToStore, quantity: 1, variants }];

      localStorage.setItem('cart', JSON.stringify(next));
      return next;
    });
  }, [selectedCurrency, lastSelection]);

  const removeFromCart = useCallback((listingId: string) => {
    persist(items.filter((i) => i.listing.id !== listingId));
  }, [items, persist]);

  const updateQuantity = useCallback((listingId: string, quantity: number) => {
    if (quantity < 1) {
      persist(items.filter((i) => i.listing.id !== listingId));
    } else {
      persist(items.map((i) => i.listing.id === listingId ? { ...i, quantity } : i));
    }
  }, [items, persist]);

  const clearCart = useCallback(() => {
    persist([]);
  }, [persist]);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  // Every item in the cart is already normalized to `selectedCurrency` —
  // both at add-time (see addToCart above) and whenever the country/
  // currency changes (see the effect below) — so summing raw prices
  // directly gives the correct total in that currency. This previously
  // ran each item through convertToUSD() first, which produced a
  // USD-magnitude number (e.g. a true UGX 44,700,000 total collapsing to
  // ~12,081) that every consumer (MobileFloatingCartBar, /checkout, this
  // cart page) then mislabeled as the selected currency — silently
  // understating totals by the exchange-rate factor for any non-USD
  // currency. convertCurrency remains in use just below for its real
  // purpose: normalizing an individual listing's price when it was posted
  // in a different currency than the one currently selected.
  const totalPrice = items.reduce(
    (sum, i) => sum + i.listing.price * i.quantity,
    0,
  );

  // When the selected country (and therefore currency) changes, convert any cart items
  useEffect(() => {
    if (!selectedCurrency) return;
    setItems((prev) => {
      const differing = Array.from(new Set(prev.map((i) => i.listing.currency))).filter((c) => c !== selectedCurrency);
      const next = prev.map((i) => {
        if (i.listing.currency === selectedCurrency) return i;
        const converted = convertCurrency(i.listing.price, i.listing.currency, selectedCurrency);
        return { ...i, listing: { ...i.listing, price: converted, currency: selectedCurrency } };
      });
      try { localStorage.setItem('cart', JSON.stringify(next)); } catch {}
      if (differing.length > 0) {
        setConversionInfo({ from: differing[0] as Currency, to: selectedCurrency, at: Date.now(), auto: lastSelection === 'auto' });
      }
      return next;
    });
  }, [selectedCurrency]);

  const clearConversionInfo = useCallback(() => setConversionInfo(null), []);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, totalItems, totalPrice, conversionInfo, clearConversionInfo }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
