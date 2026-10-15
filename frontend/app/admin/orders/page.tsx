'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Order, OrderStatus } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-indigo-100 text-indigo-800',
  SHIPPED: 'bg-purple-100 text-purple-800',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-gray-100 text-gray-800',
};

const STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [updatingId, setUpdatingId] = useState('');
  const [loadError, setLoadError] = useState(false);

  const fetchOrders = () => {
    setLoading(true);
    setLoadError(false);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (filterStatus) params.set('status', filterStatus);
    api.get(`/admin/orders?${params.toString()}`)
      .then((r) => { setOrders(r.data.orders ?? []); setTotal(r.data.pagination?.total ?? 0); })
      // A failed fetch must not look like "No orders found".
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrders(); }, [page, filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusChange = async (orderId: string, status: OrderStatus) => {
    setUpdatingId(orderId);
    try {
      let extra: { deliveryCode?: string; overrideReason?: string; refundReason?: string } = {};
      if (status === 'DELIVERED') {
        const entered = window.prompt(
          "Enter the customer's 6-digit delivery code, or type a reason for confirming delivery without it (recorded in the audit log):",
        );
        if (!entered || !entered.trim()) { setUpdatingId(''); return; }
        extra = /^[\d\s-]{6,8}$/.test(entered.trim()) ? { deliveryCode: entered.trim() } : { overrideReason: entered.trim() };
      }
      if (status === 'REFUNDED') {
        const reason = window.prompt(
          "Refund this order? The seller's payout will be taken back (their balance can go negative if they already withdrew it) and the payment marked refunded. " +
          "Piitrade does NOT send the buyer's money — you must do that yourself by MTN.\n\nReason for the refund (shown in the audit log):",
        );
        if (!reason || !reason.trim()) { setUpdatingId(''); return; }
        extra = { refundReason: reason.trim() };
      }
      await api.put(`/admin/orders/${orderId}/status`, { status, ...extra });
      fetchOrders();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      alert(msg || 'Failed to update status');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Orders ({total})</h1>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : loadError ? (
          <div role="alert" className="p-8 text-center text-red-600">
            Couldn&apos;t load orders.{' '}
            <button type="button" onClick={fetchOrders} className="underline font-medium">Retry</button>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No orders found</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Order #</th>
                <th className="px-4 py-3 text-left hidden md:table-cell">Buyer</th>
                <th className="px-4 py-3 text-left hidden lg:table-cell">Seller</th>
                <th className="px-4 py-3 text-left hidden xl:table-cell">Items &amp; Variants</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Action</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-semibold text-red-700">{order.orderNumber}</td>
                  <td className="px-4 py-3 text-gray-700 hidden md:table-cell">{order.buyer?.name}</td>
                  <td className="px-4 py-3 text-gray-700 hidden lg:table-cell">{order.seller?.name}</td>
                  {/* Variant summary — critical for logistics fulfilment */}
                  <td className="px-4 py-3 hidden xl:table-cell">
                    <div className="space-y-1 max-w-xs">
                      {(order.items ?? []).map((item: { id?: string; title?: string; quantity?: number; variantSummary?: string }, idx: number) => (
                        <div key={item.id ?? idx} className="text-xs">
                          <span className="font-medium text-gray-800 line-clamp-1">{item.title}</span>
                          {item.quantity && item.quantity > 1 && (
                            <span className="text-gray-500 ml-1">×{item.quantity}</span>
                          )}
                          {item.variantSummary && (
                            <div className="text-red-600 font-medium mt-0.5 line-clamp-1">{item.variantSummary}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(order.total, order.currency)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[order.status]}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <select
                      value={order.status}
                      onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                      disabled={updatingId === order.id}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white disabled:opacity-50"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden sm:table-cell">
                    {new Date(order.createdAt).toLocaleDateString('en-US')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-40">
            ← Prev
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-600">Page {page} / {Math.ceil(total / 20)}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / 20)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-40">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
