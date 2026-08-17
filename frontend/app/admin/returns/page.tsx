'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Return, ReturnStatus } from '@/lib/types';

const STATUS_COLORS: Record<ReturnStatus, string> = {
  REQUESTED: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  REJECTED: 'bg-red-100 text-red-800',
  RETURNED: 'bg-purple-100 text-purple-800',
  REFUNDED: 'bg-green-100 text-green-800',
};

const NEXT_STATUSES: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['RETURNED'],
  RETURNED: ['REFUNDED'],
  REJECTED: [],
  REFUNDED: [],
};

export default function AdminReturnsPage() {
  const [returns, setReturns] = useState<Return[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [updatingId, setUpdatingId] = useState('');

  const fetchReturns = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    api.get(`/admin/returns?${params.toString()}`)
      .then((r) => { setReturns(r.data.returns ?? []); setTotal(r.data.pagination?.total ?? 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchReturns(); }, [filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdate = async (returnId: string, status: ReturnStatus, resolution?: string) => {
    setUpdatingId(returnId);
    try {
      await api.put(`/admin/returns/${returnId}`, { status, resolution });
      fetchReturns();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      alert(msg || 'Failed to update return');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Returns ({total})</h1>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
        >
          <option value="">All</option>
          {(['REQUESTED', 'APPROVED', 'REJECTED', 'RETURNED', 'REFUNDED'] as ReturnStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : returns.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No returns found</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {returns.map((ret) => (
              <div key={ret.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{ret.reason}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Order: <span className="font-mono text-sky-600">{ret.order?.orderNumber}</span> · Buyer: {ret.buyer?.name}
                    </p>
                    {ret.description && <p className="text-sm text-gray-500 mt-1">{ret.description}</p>}
                    <p className="text-xs text-gray-400 mt-1">{new Date(ret.createdAt).toLocaleDateString('en-US')}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[ret.status]}`}>
                    {ret.status}
                  </span>
                </div>
                {NEXT_STATUSES[ret.status].length > 0 && (
                  <div className="flex gap-2 mt-3">
                    {NEXT_STATUSES[ret.status].map((nextStatus) => (
                      <button
                        key={nextStatus}
                        disabled={updatingId === ret.id}
                        onClick={() => {
                          const resolution = nextStatus === 'APPROVED'
                            ? window.prompt('Enter resolution note (optional):') ?? undefined
                            : undefined;
                          handleUpdate(ret.id, nextStatus, resolution);
                        }}
                        className={`text-xs px-3 py-1.5 rounded-xl font-semibold disabled:opacity-50 ${
                          nextStatus === 'APPROVED' || nextStatus === 'REFUNDED'
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : nextStatus === 'REJECTED'
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : 'bg-sky-100 text-sky-700 hover:bg-sky-200'
                        }`}
                      >
                        → {nextStatus}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
