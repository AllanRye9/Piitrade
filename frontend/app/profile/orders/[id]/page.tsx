'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, resolveImageUrl } from '@/lib/utils';
import { Order, OrderStatus } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { MobileMoneyPaymentCard } from '@/components/orders/MobileMoneyPaymentCard';
import dynamic from 'next/dynamic';

// The QR generator and camera scanner (qrcode + jsqr) are only needed when a code
// is shown or a seller confirms delivery — load them on demand so every other
// visit to this page stays light on slow mobile connections.
const DeliveryQr = dynamic(() => import('@/components/orders/DeliveryQr').then((m) => m.DeliveryQr), { ssr: false });
const DeliveryConfirmModal = dynamic(
  () => import('@/components/orders/DeliveryConfirmModal').then((m) => m.DeliveryConfirmModal),
  { ssr: false },
);
import { encodeDeliveryQr } from '@/lib/deliveryQr';

const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-indigo-100 text-indigo-800',
  SHIPPED: 'bg-purple-100 text-purple-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-gray-100 text-gray-800',
};

const TIMELINE_STEPS: { status: OrderStatus; label: string; icon: string }[] = [
  { status: 'PENDING', label: 'Order Placed', icon: '📝' },
  { status: 'CONFIRMED', label: 'Confirmed', icon: '✅' },
  { status: 'PROCESSING', label: 'Processing', icon: '⚙️' },
  { status: 'SHIPPED', label: 'Shipped', icon: '🚚' },
  { status: 'DELIVERED', label: 'Delivered', icon: '📦' },
];

const STEP_ORDER: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

export default function OrderDetailPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const { user } = useAuth();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [returnForm, setReturnForm] = useState({ open: false, reason: '', description: '' });
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api
      .get(`/orders/${id}`)
      .then((r) => setOrder(r.data.order))
      .catch(() => router.push('/profile/orders'))
      .finally(() => setLoading(false));
  }, [id, router]);

  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

  // Quietly re-fetch (no spinner, no redirect on failure).
  const reloadOrder = useCallback(() => {
    if (!id) return;
    api.get(`/orders/${id}`).then((r) => setOrder(r.data.order)).catch(() => { /* keep what we have */ });
  }, [id]);

  // While the buyer waits for an admin to confirm their MTN payment, refresh
  // every 15 s so the page flips to "confirmed" without a manual reload.
  const waitingForPayment = !!order && user?.id === order.buyerId && order.payment?.method === 'MOBILE_MONEY' && (
    (order.status === 'PENDING' && order.payment.status === 'PENDING')
    // a late payment whose proof an admin has not reviewed yet
    || (order.status === 'CANCELLED' && order.payment.status === 'FAILED' && !!order.paymentProofs?.some((p) => p.status === 'SUBMITTED'))
  );
  useEffect(() => {
    if (!waitingForPayment) return;
    const t = setInterval(reloadOrder, 15000);
    return () => clearInterval(t);
  }, [waitingForPayment, reloadOrder]);

  const handleCancel = async () => {
    if (!order || !window.confirm('Cancel this order?')) return;
    setCancelling(true);
    try {
      const r = await api.put(`/orders/${order.id}/status`, { status: 'CANCELLED' });
      setOrder(r.data.order);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to cancel order');
    } finally {
      setCancelling(false);
    }
  };

  // Buyer confirms they received the goods — this is itself the proof of
  // delivery (no code needed) and releases the seller's payout.
  const handleConfirmReceived = async () => {
    if (!order || !window.confirm('Confirm that you received this order? This releases payment to the seller.')) return;
    setConfirming(true);
    setError('');
    try {
      const r = await api.put(`/orders/${order.id}/status`, { status: 'DELIVERED' });
      setOrder((prev) => (prev ? { ...prev, ...r.data.order, deliveryCode: undefined } : prev));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to confirm receipt');
    } finally {
      setConfirming(false);
    }
  };

  // Seller confirms handover with the customer's code (scanned or typed).
  // Returns an error message for the modal to show, or null on success.
  const confirmDeliveryWithCode = async (deliveryCode: string): Promise<string | null> => {
    if (!order) return 'Order not loaded';
    try {
      const r = await api.put(`/orders/${order.id}/status`, { status: 'DELIVERED', deliveryCode });
      setOrder((prev) => (prev ? { ...prev, ...r.data.order } : prev));
      return null;
    } catch (e: unknown) {
      return (e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to confirm delivery';
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setSubmittingReturn(true);
    try {
      await api.post(`/orders/${order.id}/return`, {
        reason: returnForm.reason,
        description: returnForm.description,
      });
      setReturnForm({ open: false, reason: '', description: '' });
      // Refresh order
      const r = await api.get(`/orders/${order.id}`);
      setOrder(r.data.order);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to submit return');
    } finally {
      setSubmittingReturn(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}
      </div>
    );
  }

  if (!order) return null;

  const isBuyer = user?.id === order.buyerId;
  const isSeller = user?.id === order.sellerId;
  const currentStepIdx = STEP_ORDER.indexOf(order.status);
  const isCancelled = order.status === 'CANCELLED' || order.status === 'REFUNDED';

  return (
    <div className="max-w-4xl mx-auto px-4 py-4">
      <Breadcrumb items={[
        { label: 'Profile', href: '/profile' },
        { label: 'Orders', href: '/profile/orders' },
        { label: order.orderNumber },
      ]} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Order <span className="font-mono text-red-600">{order.orderNumber}</span>
        </h1>
        <span className={`px-4 py-1.5 rounded-full text-sm font-semibold ${STATUS_COLORS[order.status]}`}>
          {order.status}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">{error}</div>
      )}

      {/* Timeline */}
      {!isCancelled && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between relative">
            {/* Progress line */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-gray-200 z-0" />
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-red-500 z-0 transition-all"
              style={{ width: `${Math.max(0, currentStepIdx) / (TIMELINE_STEPS.length - 1) * 100}%` }}
            />
            {TIMELINE_STEPS.map((step, i) => (
              <div key={step.status} className="relative z-10 flex flex-col items-center gap-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all ${
                  i <= currentStepIdx
                    ? 'bg-red-500 border-red-500 text-white'
                    : 'bg-white border-gray-200 text-gray-400'
                }`}>
                  {step.icon}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${i <= currentStepIdx ? 'text-red-700' : 'text-gray-400'}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_340px] gap-6">
        {/* Items */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <h2 className="px-5 py-3 font-semibold text-gray-900 border-b border-gray-100">Order Items</h2>
            <div className="divide-y divide-gray-50">
              {order.items.map((item) => {
                const img = item.imageUrl ?? item.listing?.images?.[0] ?? null;
                return (
                  <div key={item.id} className="flex gap-4 items-center px-5 py-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                      {img ? (
                        <Image src={resolveImageUrl(img)} alt={item.title} width={64} height={64} className="object-cover w-full h-full" unoptimized />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl">🏷️</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link href={`/listings/${item.listingId}`} className="font-medium text-gray-900 hover:text-red-600 transition-colors line-clamp-2">
                        {item.title}
                      </Link>
                      <p className="text-sm text-gray-500">Qty: {item.quantity} × {formatCurrency(item.price, item.currency)}</p>
                    </div>
                    <p className="font-bold text-red-700 whitespace-nowrap">
                      {formatCurrency(item.price * item.quantity, item.currency)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Shipping address */}
          {order.shippingAddress && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Shipping Address</h2>
              <p className="text-sm text-gray-700">{order.shippingAddress.fullName}</p>
              <p className="text-sm text-gray-500">{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}</p>
              <p className="text-sm text-gray-500">{order.shippingAddress.city}{order.shippingAddress.state ? `, ${order.shippingAddress.state}` : ''} {order.shippingAddress.postalCode}</p>
              <p className="text-sm text-gray-500">{order.shippingAddress.country}</p>
              <p className="text-sm text-gray-500 mt-1">📞 {order.shippingAddress.phone}</p>
            </div>
          )}

          {/* Tracking */}
          {order.trackingNumber && (
            <div className="bg-red-50 rounded-2xl border border-red-100 p-5">
              <h2 className="font-semibold text-red-900 mb-1">Tracking</h2>
              <p className="text-sm text-red-700 font-mono">{order.trackingNumber}</p>
              {order.shippedAt && <p className="text-xs text-red-500 mt-1">Shipped on {new Date(order.shippedAt).toLocaleDateString('en-US')}</p>}
            </div>
          )}

          {/* Returns */}
          {order.returns && order.returns.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Return Requests</h2>
              {order.returns.map((ret) => (
                <div key={ret.id} className="text-sm border border-gray-100 rounded-xl p-3 mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-medium text-gray-800">{ret.reason}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      ret.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                      ret.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>{ret.status}</span>
                  </div>
                  {ret.description && <p className="text-gray-500 text-xs">{ret.description}</p>}
                  {ret.resolution && <p className="text-gray-600 text-xs mt-1">Resolution: {ret.resolution}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Summary + actions */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatCurrency(order.subtotal, order.currency)}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount{order.coupon ? ` (${order.coupon.code})` : ''}</span>
                  <span>−{formatCurrency(order.discount, order.currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>Shipping</span>
                <span>{order.shippingCost > 0 ? formatCurrency(order.shippingCost, order.currency) : 'Free'}</span>
              </div>
              {order.tax > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>Tax</span>
                  <span>{formatCurrency(order.tax, order.currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-100 pt-2">
                <span>Total</span>
                <span className="text-red-700">{formatCurrency(order.total, order.currency)}</span>
              </div>
            </div>
          </div>

          {/* Payment info */}
          {order.payment && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 mb-2">Payment</h2>
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Method</span>
                  <span className="text-gray-800">{order.payment.method.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className={`font-semibold ${order.payment.status === 'COMPLETED' ? 'text-green-600' : order.payment.status === 'FAILED' ? 'text-red-600' : 'text-yellow-600'}`}>
                    {order.payment.status}
                  </span>
                </div>
                {order.payment.paidAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Paid at</span>
                    <span className="text-gray-700">{new Date(order.payment.paidAt).toLocaleDateString('en-US')}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Contact info */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-2">{isBuyer ? 'Seller' : 'Buyer'}</h2>
            <div className="text-sm text-gray-700">
              <p className="font-medium">{isBuyer ? order.seller?.name : order.buyer?.name}</p>
              <p className="text-gray-500">{isBuyer ? order.seller?.email : order.buyer?.email}</p>
            </div>
          </div>

          {/* Manual MTN payment (buyer only; renders nothing unless this order awaits payment) */}
          {isBuyer && <MobileMoneyPaymentCard order={order} onChanged={reloadOrder} />}

          {isSeller && order.status === 'PENDING' && order.payment?.method === 'MOBILE_MONEY' && order.payment.status === 'PENDING' && (
            <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
              ⏳ <strong>Waiting for the buyer&apos;s payment.</strong> Piitrade confirms it first; you will be able to prepare this order as soon as it is confirmed.
            </div>
          )}

          {isSeller && showDeliveryModal && (
            <DeliveryConfirmModal
              orderNumber={order.orderNumber}
              onSubmit={confirmDeliveryWithCode}
              onClose={() => setShowDeliveryModal(false)}
            />
          )}

          {/* Delivery code — buyer's proof of receipt; never sent to the seller */}
          {isBuyer && order.deliveryCode && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Your delivery code</p>
              <div className="mt-3">
                <DeliveryQr value={encodeDeliveryQr(order.orderNumber, order.deliveryCode)} />
              </div>
              <p className="mt-1 text-3xl font-bold tracking-[0.3em] text-emerald-900" aria-label="Delivery code">
                {order.deliveryCode.slice(0, 3)} {order.deliveryCode.slice(3)}
              </p>
              <p className="mt-2 text-xs text-emerald-800">
                Give this code to the seller <strong>only when you have your item in hand</strong>.
                Never share it earlier or send it in a message — the seller is paid when it is entered.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            {isBuyer && order.status === 'PENDING' && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full py-3 rounded-xl border border-red-300 text-red-600 hover:bg-red-50 font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : '❌ Cancel Order'}
              </button>
            )}
            {isBuyer && order.status === 'DELIVERED' && (!order.returns || order.returns.length === 0) && (
              <button
                onClick={() => setReturnForm((p) => ({ ...p, open: true }))}
                className="w-full py-3 rounded-xl border border-orange-300 text-orange-600 hover:bg-orange-50 font-semibold text-sm transition-colors"
              >
                ↩️ Request Return
              </button>
            )}
            {isSeller && (order.status === 'CONFIRMED' || order.status === 'PROCESSING') && (
              <button
                onClick={async () => {
                  const tracking = window.prompt('Enter tracking number (optional):');
                  try {
                    const r = await api.put(`/orders/${order.id}/status`, { status: 'SHIPPED', trackingNumber: tracking || undefined });
                    setOrder(r.data.order);
                  } catch (e: unknown) {
                    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
                    setError(msg || 'Failed to update status');
                  }
                }}
                className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors"
              >
                🚚 Mark as Shipped
              </button>
            )}
            {isBuyer && order.status === 'SHIPPED' && (
              <button
                onClick={handleConfirmReceived}
                disabled={confirming}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {confirming ? 'Confirming...' : '✅ I received my order'}
              </button>
            )}
            {isSeller && order.status === 'SHIPPED' && (
              <button
                onClick={() => setShowDeliveryModal(true)}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm transition-colors"
              >
                🔐 Confirm delivery (scan or enter customer&apos;s code)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Return modal */}
      {returnForm.open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Request Return</h3>
            <form onSubmit={handleReturnSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Reason *</label>
                <select
                  value={returnForm.reason}
                  onChange={(e) => setReturnForm((p) => ({ ...p, reason: e.target.value }))}
                  required
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  <option value="">Select a reason</option>
                  <option>Item not as described</option>
                  <option>Defective/damaged item</option>
                  <option>Wrong item received</option>
                  <option>Changed my mind</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <textarea
                  value={returnForm.description}
                  onChange={(e) => setReturnForm((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                  placeholder="Describe the issue..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setReturnForm({ open: false, reason: '', description: '' })}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReturn}
                  className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:opacity-50"
                >
                  {submittingReturn ? 'Submitting...' : 'Submit Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
