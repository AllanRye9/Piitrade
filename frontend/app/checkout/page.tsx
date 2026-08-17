'use client';

import { useState } from 'react';
import { useCart } from '@/context/CartContext';
import { useCountry } from '@/context/CountryContext';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, resolveImageUrl } from '@/lib/utils';
import { api } from '@/lib/api';
import Image from 'next/image';
import Link from 'next/link';
import { Breadcrumb } from '@/components/ui/Breadcrumb';

type Step = 'details' | 'payment' | 'confirmation';

const PAYMENT_METHOD_MAP: Record<string, string> = {
  card: 'CARD',
  mobile: 'MOBILE_MONEY',
  bank: 'BANK_TRANSFER',
  cod: 'CASH_ON_DELIVERY',
};

export default function CheckoutPage() {
  const { items, totalPrice, clearCart } = useCart();
  const { currency } = useCountry();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('details');
  const [submitting, setSubmitting] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    address: '',
    city: '',
    country: 'UAE',
    notes: '',
  });

  const [payment, setPayment] = useState({
    method: 'card',
    cardNumber: '',
    expiry: '',
    cvv: '',
    cardName: '',
  });

  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; type: string; value: number; label: string } | null>(null);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handlePaymentChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPayment((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError('');
    setCouponLoading(true);
    try {
      const { data } = await api.get(`/coupons/validate?code=${encodeURIComponent(couponCode.trim())}`);
      const label =
        data.type === 'PERCENTAGE'
          ? `${data.value}% off`
          : data.type === 'FREE_SHIPPING'
          ? 'Free shipping'
          : `${formatCurrency(data.value, currency)} off`;
      setAppliedCoupon({ code: data.code, type: data.type, value: data.value, label });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setCouponError(msg || 'Invalid coupon code');
      setAppliedCoupon(null);
    } finally {
      setCouponLoading(false);
    }
  };

  const [paymentError, setPaymentError] = useState('');

  const handlePlaceOrder = async () => {
    setPaymentError('');
    setError('');
    if (payment.method === 'card') {
      if (!payment.cardName || !payment.cardNumber || !payment.expiry || !payment.cvv) {
        setPaymentError('Please fill in all card details.');
        return;
      }
    }
    setSubmitting(true);
    try {
      // Send per-line prices in the displayed currency to enforce transparent pricing.
      // Each item also carries the buyer's variant selections (colour, size, motor attrs)
      // so the admin / logistics team can fulfil the exact specification ordered.
      const orderItems = items.map(({ listing, quantity, variants }) => ({
        listingId: listing.id,
        quantity,
        unitPrice: listing.price,
        currency:  listing.currency,
        // Variant selections forwarded verbatim to the order record
        selectedColor:      variants?.color      ?? undefined,
        selectedSize:       variants?.size        ?? undefined,
        selectedAttributes: variants?.attributes  ?? undefined,
      }));

      const { data } = await api.post('/orders', {
        items: orderItems,
        paymentMethod: PAYMENT_METHOD_MAP[payment.method] ?? 'CASH_ON_DELIVERY',
        couponCode: appliedCoupon?.code ?? undefined,
        notes: form.notes || undefined,
        currency,
        // Also include the displayed totals so backend can validate
        displayTotal: displayTotal,
        displayFinalTotal: finalTotal,
      });

      setOrderNumber(data.order.orderNumber);
      setOrderId(data.order.id);
      clearCart();
      setStep('confirmation');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to place order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0 && step !== 'confirmation') {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center px-4 py-8">
        <div className="text-7xl mb-6">🛒</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Your cart is empty</h1>
        <Link href="/listings" className="px-8 py-3 rounded-xl bg-sky-500 text-white font-semibold">Browse Listings</Link>
      </div>
    );
  }

  if (step === 'confirmation') {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center px-4 py-8 text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center text-4xl mb-6">✅</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Order Placed!</h1>
        <p className="text-gray-500 max-w-md mb-2">
          Thank you, <strong>{form.name || user?.name}</strong>! Your order has been received and is being processed.
        </p>
        {orderNumber && (
          <p className="text-gray-400 text-sm mb-2">
            Order number: <strong className="font-mono text-sky-600">{orderNumber}</strong>
          </p>
        )}
        <p className="text-gray-400 text-sm mb-4">
          A confirmation will be sent to <strong>{form.email || user?.email}</strong>
        </p>
        <div className="flex gap-4 flex-wrap justify-center">
          <Link href="/listings" className="px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold transition-colors">
            Continue Shopping
          </Link>
          {orderId && (
            <Link href={`/profile/orders/${orderId}`} className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold transition-colors">
              View Order
            </Link>
          )}
          <Link href="/profile/orders" className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold transition-colors">
            My Orders
          </Link>
        </div>
      </div>
    );
  }

  // Use the selected country currency and compute display totals in that currency.
  const displayTotal = items.reduce((s, i) => s + i.listing.price * i.quantity, 0);

  // Compute discount amount for display (appliedCoupon values are assumed in display currency)
  const discountAmount = (() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === 'PERCENTAGE') return displayTotal * (appliedCoupon.value / 100);
    if (appliedCoupon.type === 'FIXED_AMOUNT') return Math.min(appliedCoupon.value, displayTotal);
    return 0;
  })();
  const finalTotal = Math.max(0, displayTotal - discountAmount);

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Cart', href: '/cart' },
          { label: 'Checkout' },
        ]}
      />
      {/* Progress steps */}
      <div className="flex items-center gap-2 mb-4">
        {(['details', 'payment'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              step === s ? 'bg-sky-500 text-white' : 'bg-gray-200 text-gray-500'
            }`}>{i + 1}</div>
            <span className={`text-sm font-medium capitalize ${step === s ? 'text-sky-600' : 'text-gray-400'}`}>
              {s === 'details' ? 'Delivery Details' : 'Payment'}
            </span>
            {i === 0 && <span className="text-gray-300 mx-1">→</span>}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: form */}
        <div>
          {step === 'details' && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h2 className="text-lg font-bold text-gray-900">Delivery Details</h2>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input name="name" value={form.name} onChange={handleFormChange} required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input type="email" name="email" value={form.email} onChange={handleFormChange} required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input name="phone" value={form.phone} onChange={handleFormChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
                  <select name="country" value={form.country} onChange={handleFormChange}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white">
                    <option value="UAE">🇦🇪 United Arab Emirates</option>
                    <option value="UGANDA">🇺🇬 Uganda</option>
                    <option value="KENYA">🇰🇪 Kenya</option>
                    <option value="CHINA">🇨🇳 China</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Address *</label>
                  <input name="address" value={form.address} onChange={handleFormChange} required
                    placeholder="Street address, building, apartment..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                  <input name="city" value={form.city} onChange={handleFormChange} required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Order Notes (optional)</label>
                <textarea name="notes" value={form.notes} onChange={handleFormChange} rows={3}
                  placeholder="Any special instructions for delivery..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none" />
              </div>

              <button
                onClick={() => setStep('payment')}
                disabled={!form.name || !form.email || !form.address || !form.city}
                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition-colors"
              >
                Continue to Payment →
              </button>
            </div>
          )}

          {step === 'payment' && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <button onClick={() => setStep('details')} className="text-sky-500 hover:text-sky-700 text-sm font-medium">
                  ← Back
                </button>
                <h2 className="text-lg font-bold text-gray-900">Payment Method</h2>
              </div>

              {/* Payment method selector */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: 'card', label: 'Credit Card', icon: '💳' },
                  { id: 'mobile', label: 'Mobile Money', icon: '📱' },
                  { id: 'bank', label: 'Bank Transfer', icon: '🏦' },
                  { id: 'cod', label: 'Cash on Delivery', icon: '💵' },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setPayment((p) => ({ ...p, method: m.id }))}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all text-xs font-semibold ${
                      payment.method === m.id
                        ? 'border-sky-500 bg-sky-50 text-sky-700'
                        : 'border-gray-200 text-gray-600 hover:border-sky-200'
                    }`}
                  >
                    <span className="text-xl">{m.icon}</span>
                    {m.label}
                  </button>
                ))}
              </div>

              {payment.method === 'card' && (
                <div className="space-y-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name on Card</label>
                    <input name="cardName" value={payment.cardName} onChange={handlePaymentChange}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Card Number</label>
                    <input name="cardNumber" value={payment.cardNumber} onChange={handlePaymentChange}
                      placeholder="1234 5678 9012 3456" maxLength={19}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 font-mono" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
                      <input name="expiry" value={payment.expiry} onChange={handlePaymentChange}
                        placeholder="MM/YY" maxLength={5}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">CVV</label>
                      <input name="cvv" value={payment.cvv} onChange={handlePaymentChange}
                        placeholder="123" maxLength={4} type="password"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" />
                    </div>
                  </div>
                </div>
              )}

              {payment.method === 'mobile' && (
                <div className="bg-sky-50 rounded-xl p-4 text-sm text-sky-800">
                  <p className="font-semibold mb-1">Mobile Money Instructions</p>
                  <p>Send payment to <strong>+254 700 000 000</strong> (M-Pesa / MTN / Airtel) and include your order number in the reference.</p>
                </div>
              )}

              {payment.method === 'bank' && (
                <div className="bg-sky-50 rounded-xl p-4 text-sm text-sky-800 space-y-1">
                  <p className="font-semibold mb-1">Bank Transfer Details</p>
                  <p>Bank: <strong>Piitrade Bank</strong></p>
                  <p>Account: <strong>1234-5678-9012</strong></p>
                  <p>Reference: <strong>Your name + order number</strong></p>
                </div>
              )}

              {payment.method === 'cod' && (
                <div className="bg-amber-50 rounded-xl p-4 text-sm text-amber-800">
                  <p className="font-semibold mb-1">Cash on Delivery</p>
                  <p>Pay when your order arrives. Make sure to have the exact amount ready.</p>
                </div>
              )}

              {(paymentError || error) && (
                <p className="text-red-600 text-sm font-medium bg-red-50 rounded-xl px-4 py-2">{paymentError || error}</p>
              )}

              <button
                onClick={handlePlaceOrder}
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-base transition-all shadow-md"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Placing Order...
                  </span>
                ) : (
                  `✓ Place Order · ${formatCurrency(finalTotal, currency)}`
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right: order summary */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 h-fit sticky top-24">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {items.map(({ listing, quantity }) => {
              const img = listing.productImages?.[0]?.cdnUrl ?? listing.images?.[0] ?? null;
              return (
                <div key={listing.id} className="flex gap-3">
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    {img ? (
                      <Image src={resolveImageUrl(img)} alt={listing.title} fill className="object-cover" unoptimized />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-lg">🏷️</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 line-clamp-2">{listing.title}</p>
                    <p className="text-xs text-gray-500">×{quantity}</p>
                  </div>
                  <span className="text-xs font-semibold text-gray-900 whitespace-nowrap">
                    {formatCurrency(listing.price * quantity, listing.currency)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Coupon */}
          <form onSubmit={handleApplyCoupon} className="mt-4 border-t border-gray-100 pt-4">
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Promo Code</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => { setCouponCode(e.target.value); setCouponError(''); }}
                placeholder="Enter code"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                disabled={!!appliedCoupon}
              />
              {appliedCoupon ? (
                <button type="button" onClick={() => { setAppliedCoupon(null); setCouponCode(''); }}
                  className="px-3 py-2 text-xs text-red-500 border border-red-200 rounded-xl hover:bg-red-50">
                  Remove
                </button>
              ) : (
                <button type="submit" disabled={couponLoading || !couponCode.trim()}
                  className="px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold rounded-xl disabled:opacity-50">
                  {couponLoading ? '...' : 'Apply'}
                </button>
              )}
            </div>
            {appliedCoupon && <p className="mt-1.5 text-xs text-emerald-600 font-medium">✓ {appliedCoupon.code} – {appliedCoupon.label}</p>}
            {couponError && <p className="mt-1.5 text-xs text-red-500">{couponError}</p>}
          </form>

          <div className="border-t border-gray-100 mt-4 pt-4 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(totalPrice, currency)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600 font-medium">
                <span>Discount</span>
                <span>−{formatCurrency(discountAmount, currency)}</span>
              </div>
            )}
            <div className="flex justify-between items-center border-t border-gray-100 pt-2">
              <span className="font-bold text-gray-900">Total</span>
              <span className="text-xl font-bold text-sky-600">{formatCurrency(finalTotal, currency)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

