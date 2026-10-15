'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Withdrawal, WithdrawalStatus } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

const STATUS_COLORS: Record<WithdrawalStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  REJECTED: 'bg-red-100 text-red-800',
  COMPLETED: 'bg-green-100 text-green-800',
};

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [updatingId, setUpdatingId] = useState('');

  const fetchWithdrawals = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    api.get(`/admin/withdrawals?${params.toString()}`)
      .then((r) => { setWithdrawals(r.data.withdrawals ?? []); setTotal(r.data.pagination?.total ?? 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchWithdrawals(); }, [filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdate = async (id: string, status: WithdrawalStatus) => {
    const note = status === 'REJECTED' ? window.prompt('Rejection reason:') ?? undefined : undefined;
    setUpdatingId(id);
    try {
      await api.put(`/admin/withdrawals/${id}`, { status, note });
      fetchWithdrawals();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      alert(msg || 'Failed to update withdrawal');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Withdrawals ({total})</h1>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
        >
          <option value="">All</option>
          {(['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'] as WithdrawalStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : withdrawals.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No withdrawal requests found</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left hidden sm:table-cell">Method</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {withdrawals.map((w) => (
                <tr key={w.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{(w as Withdrawal & { user?: { name: string } }).user?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(w.amount, w.currency)}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{w.method.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[w.status]}`}>
                      {w.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {w.status === 'PENDING' && (
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => handleUpdate(w.id, 'COMPLETED')} disabled={updatingId === w.id}
                          className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50">
                          Approve
                        </button>
                        <button onClick={() => handleUpdate(w.id, 'REJECTED')} disabled={updatingId === w.id}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50">
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
