'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, resolveImageUrl } from '@/lib/utils';
import { Order, OrderStatus } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';

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
          Order <span className="font-mono text-sky-600">{order.orderNumber}</span>
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
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-sky-500 z-0 transition-all"
              style={{ width: `${Math.max(0, currentStepIdx) / (TIMELINE_STEPS.length - 1) * 100}%` }}
            />
            {TIMELINE_STEPS.map((step, i) => (
              <div key={step.status} className="relative z-10 flex flex-col items-center gap-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all ${
                  i <= currentStepIdx
                    ? 'bg-sky-500 border-sky-500 text-white'
                    : 'bg-white border-gray-200 text-gray-400'
                }`}>
                  {step.icon}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${i <= currentStepIdx ? 'text-sky-700' : 'text-gray-400'}`}>
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
                      <Link href={`/listings/${item.listingId}`} className="font-medium text-gray-900 hover:text-sky-600 transition-colors line-clamp-2">
                        {item.title}
                      </Link>
                      <p className="text-sm text-gray-500">Qty: {item.quantity} × {formatCurrency(item.price, item.currency)}</p>
                    </div>
                    <p className="font-bold text-sky-700 whitespace-nowrap">
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
            <div className="bg-sky-50 rounded-2xl border border-sky-100 p-5">
              <h2 className="font-semibold text-sky-900 mb-1">Tracking</h2>
              <p className="text-sm text-sky-700 font-mono">{order.trackingNumber}</p>
              {order.shippedAt && <p className="text-xs text-sky-500 mt-1">Shipped on {new Date(order.shippedAt).toLocaleDateString('en-US')}</p>}
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
                <span className="text-sky-700">{formatCurrency(order.total, order.currency)}</span>
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
                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm transition-colors"
              >
                🚚 Mark as Shipped
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
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
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
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"
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
