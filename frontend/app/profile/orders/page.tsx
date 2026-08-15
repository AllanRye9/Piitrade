'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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

const STATUS_ICONS: Record<OrderStatus, string> = {
  PENDING: '⏳',
  CONFIRMED: '✅',
  PROCESSING: '⚙️',
  SHIPPED: '🚚',
  DELIVERED: '📦',
  CANCELLED: '❌',
  REFUNDED: '↩️',
};

export default function OrdersPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState<'buyer' | 'seller'>('buyer');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const params = new URLSearchParams({ role: activeRole });
    if (filterStatus) params.set('status', filterStatus);
    api
      .get(`/orders?${params.toString()}`)
      .then((r) => setOrders(r.data.orders ?? []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [user, activeRole, filterStatus]);

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-gray-500">Please <Link href="/auth/login" className="text-sky-600 underline">log in</Link> to view your orders.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <Breadcrumb items={[{ label: 'Profile', href: '/profile' }, { label: 'Orders' }]} />
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Orders</h1>

      {/* Role tabs */}
      <div className="flex gap-2 mb-6">
        {(['buyer', 'seller'] as const).map((r) => (
          <button
            key={r}
            onClick={() => { setActiveRole(r); setFilterStatus(''); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              activeRole === r ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {r === 'buyer' ? '🛒 My Purchases' : '🏪 My Sales'}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['', 'PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filterStatus === s
                ? 'bg-sky-500 text-white border-sky-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-sky-400'
            }`}
          >
            {s ? `${STATUS_ICONS[s as OrderStatus]} ${s}` : 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-6xl mb-4">📦</div>
          <p className="text-gray-500 text-lg mb-4">No orders found</p>
          <Link href="/listings" className="px-6 py-3 rounded-xl bg-sky-500 text-white font-semibold">
            Browse Listings
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Order header */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100">
                <div>
                  <span className="text-xs text-gray-500">Order #</span>
                  <span className="ml-1 font-mono font-semibold text-gray-800">{order.orderNumber}</span>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[order.status]}`}>
                  {STATUS_ICONS[order.status]} {order.status}
                </span>
                <span className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleDateString('en-US')}</span>
                <Link
                  href={`/profile/orders/${order.id}`}
                  className="text-xs text-sky-600 hover:text-sky-800 font-semibold"
                >
                  View Details →
                </Link>
              </div>

              {/* Order items */}
              <div className="divide-y divide-gray-50">
                {order.items.slice(0, 3).map((item) => {
                  const img = item.imageUrl ?? item.listing?.images?.[0] ?? null;
                  return (
                    <div key={item.id} className="flex gap-3 items-center px-5 py-3">
                      <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                        {img ? (
                          <Image src={resolveImageUrl(img)} alt={item.title} width={56} height={56} className="object-cover w-full h-full" unoptimized />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xl">🏷️</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                        <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                      </div>
                      <p className="text-sm font-semibold text-sky-700 whitespace-nowrap">
                        {formatCurrency(item.price * item.quantity, item.currency)}
                      </p>
                    </div>
                  );
                })}
                {order.items.length > 3 && (
                  <p className="px-5 py-2 text-xs text-gray-400">+{order.items.length - 3} more item(s)</p>
                )}
              </div>

              {/* Order footer */}
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-t border-gray-100">
                <div className="text-xs text-gray-500">
                  {activeRole === 'buyer'
                    ? `Seller: ${order.seller?.name ?? 'Unknown'}`
                    : `Buyer: ${order.buyer?.name ?? 'Unknown'}`}
                </div>
                <div className="text-sm font-bold text-gray-900">
                  Total: {formatCurrency(order.total, order.currency)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Support CTA */}
      <div className="mt-8 flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">Need help with an order?</p>
          <p className="text-xs text-gray-500 mt-0.5">Contact our support team directly.</p>
        </div>
        <a
          href="mailto:support@piitrade.com"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors"
        >
          ✉️ Email Support
        </a>
      </div>
    </div>
  );
}
