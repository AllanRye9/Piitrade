'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type TransactionType = 'PURCHASE' | 'REFUND' | 'SUBSCRIPTION' | 'STORE_FEE' | 'PAYOUT' | 'CV_DOWNLOAD';

interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  reference: string | null;
  description: string;
  userId: string | null;
  userName: string;
  userEmail: string | null;
}

const TYPE_LABELS: Record<TransactionType, string> = {
  PURCHASE: 'Purchase',
  REFUND: 'Refund',
  SUBSCRIPTION: 'Subscription',
  STORE_FEE: 'Store Fee',
  PAYOUT: 'Payout',
  CV_DOWNLOAD: 'CV Download',
};

const TYPE_COLORS: Record<TransactionType, string> = {
  PURCHASE: 'bg-blue-100 text-blue-800',
  REFUND: 'bg-orange-100 text-orange-800',
  SUBSCRIPTION: 'bg-purple-100 text-purple-800',
  STORE_FEE: 'bg-teal-100 text-teal-800',
  PAYOUT: 'bg-indigo-100 text-indigo-800',
  CV_DOWNLOAD: 'bg-pink-100 text-pink-800',
};

// The five source tables (Payment, Withdrawal, StoreRental, SellerSubscription,
// CvDownloadToken) each carry their own status enum rather than one shared
// taxonomy — see the block comment above GET /admin/transactions in
// backend/src/routes/admin.ts for why. Bucketing by these generic keywords
// (rather than hard-coding every enum value from every table) keeps the
// color coding correct even for status values not explicitly listed here.
function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (['COMPLETED', 'APPROVED', 'ACTIVE'].includes(s)) return 'bg-green-100 text-green-800';
  if (['PENDING', 'PENDING_PAYMENT'].includes(s)) return 'bg-yellow-100 text-yellow-800';
  if (['FAILED', 'REJECTED', 'CANCELLED'].includes(s)) return 'bg-red-100 text-red-800';
  if (['REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED'].includes(s)) return 'bg-gray-200 text-gray-700';
  return 'bg-gray-100 text-gray-600';
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    // Intl.NumberFormat throws on an unrecognized ISO currency code — falls
    // back to a plain "<code> <amount>" rendering rather than crashing the
    // whole row (CvDownloadToken.currency is a free-text field in the
    // schema, not the Currency enum, so this is a real, if rare, case).
    return `${currency} ${amount.toLocaleString()}`;
  }
}

const REFRESH_INTERVAL_MS = 30_000;
const PAGE_SIZE = 20;

export default function AdminTransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const buildParams = useCallback((forPage: number) => {
    const params: Record<string, string> = { page: String(forPage), limit: String(PAGE_SIZE) };
    if (type) params.type = type;
    if (status) params.status = status;
    if (search) params.search = search;
    if (dateFrom) params.dateFrom = new Date(dateFrom).toISOString();
    if (dateTo) params.dateTo = new Date(dateTo).toISOString();
    if (minAmount) params.minAmount = minAmount;
    if (maxAmount) params.maxAmount = maxAmount;
    return params;
  }, [type, status, search, dateFrom, dateTo, minAmount, maxAmount]);

  const fetchTransactions = useCallback((forPage: number, showSpinner = true) => {
    if (showSpinner) setLoading(true);
    api.get('/admin/transactions', { params: buildParams(forPage) })
      .then(({ data }) => {
        setTransactions(data.transactions || []);
        setTotal(data.pagination?.total || 0);
        setPages(data.pagination?.pages || 1);
      })
      .catch(() => { setTransactions([]); setTotal(0); setPages(1); })
      .finally(() => setLoading(false));
  }, [buildParams]);

  // Refetch page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
    fetchTransactions(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, status, search, dateFrom, dateTo, minAmount, maxAmount]);

  useEffect(() => {
    fetchTransactions(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // "Real-time updates": a REST admin dashboard has no open socket to push
  // through, so this polls quietly in the background on the current page
  // and filters, without showing the full-page loading state each time (a
  // spinner every 30s on an otherwise-idle screen would be more disruptive
  // than helpful). The Live toggle lets an admin pause this while reading.
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => fetchTransactions(pageRef.current, false), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live, fetchTransactions]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.get('/admin/transactions/export', {
        params: buildParams(1),
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to export transactions');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setType(''); setStatus(''); setSearch(''); setDateFrom(''); setDateTo(''); setMinAmount(''); setMaxAmount('');
  };

  const hasFilters = Boolean(type || status || search || dateFrom || dateTo || minAmount || maxAmount);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transaction History ({total})</h1>
          <p className="text-xs text-gray-400 mt-0.5">Purchases, refunds, subscriptions, store fees, and payouts in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border ${live ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500'}`}
            title={live ? 'Auto-refreshing every 30s — click to pause' : 'Auto-refresh paused — click to resume'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
            {live ? 'Live' : 'Paused'}
          </button>
          <button
            type="button"
            onClick={() => fetchTransactions(page)}
            className="text-xs font-semibold px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          >
            ⟳ Refresh
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="text-xs font-semibold px-3 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : '⬇ Export CSV'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <select value={type} onChange={(e) => setType(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white col-span-1">
          <option value="">All types</option>
          {(Object.keys(TYPE_LABELS) as TransactionType[]).map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
        <input
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          placeholder="Status (e.g. COMPLETED)"
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email"
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm col-span-2 sm:col-span-1"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
          title="To date"
        />
        <input
          type="number"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
          placeholder="Min amount"
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <input
            type="number"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="Max amount"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1"
          />
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="text-xs px-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 shrink-0">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        ) : transactions.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No transactions found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">Method</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(t.date).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${TYPE_COLORS[t.type]}`}>
                        {TYPE_LABELS[t.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate" title={t.description}>{t.description}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900 font-medium truncate max-w-[160px]">{t.userName}</p>
                      {t.userEmail && <p className="text-gray-400 text-xs truncate max-w-[160px]">{t.userEmail}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                      {t.type === 'REFUND' ? '-' : ''}{formatMoney(t.amount, t.currency)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{t.method ? t.method.replace(/_/g, ' ') : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${statusColor(t.status)}`}>
                        {t.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell truncate max-w-[140px]" title={t.reference || undefined}>
                      {t.reference || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-gray-500">Page {page} of {pages}</span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
