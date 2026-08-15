'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { getApiBaseUrl } from '@/lib/apiUrl';
import { api } from '@/lib/api';
import { Listing } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { CurrencyDisplay } from '@/components/ui/CurrencyDisplay';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';

const PLACEMENT_OPTIONS = [
  { value: 'LATEST_COLLECTIONS', label: '⭐ Premium Collections' },
  { value: 'FEATURED_DEAL', label: '✦ FEATURED DEAL' },
  { value: 'FLASH_SALE', label: '⚡ Flash Sale' },
];

interface ApproveModal {
  listingId: string;
  title: string;
  images: string[];
  placement: Listing['placement'];
  durationHours: string;
}

type BulkAction = 'approve' | 'reject' | 'delete' | 'feature';

export default function AdminListingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [approveModal, setApproveModal] = useState<ApproveModal | null>(null);
  const [approving, setApproving] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchListings = useCallback(async (query: string, status: string) => {
    try {
      setFetching(true);
      setActionError('');
      const params: Record<string, string> = {};
      if (query) params.search = query;
      if (status) params.status = status;
      const { data } = await api.get('/admin/listings', { params });
      setListings(data.listings);
      setTotal(data.pagination.total);
      setSelectedIds(new Set());
    } catch {
      setActionError('Failed to load listings.');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchListings(search, statusFilter), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, statusFilter, user, fetchListings]);

  const updateStatus = async (listingId: string, status: string) => {
    setActionLoadingId(listingId);
    setActionError('');
    try {
      const { data } = await api.put(`/admin/listings/${listingId}`, { status });
      setListings((prev) => prev.map((l) => l.id === listingId ? { ...l, ...data } : l));
      setActionMessage(`Listing updated to ${status}.`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(msg || 'Failed to update listing status.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const deleteListing = async (listingId: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`)) return;
    setActionLoadingId(listingId);
    setActionError('');
    try {
      await api.delete(`/admin/listings/${listingId}`);
      await fetchListings(search, statusFilter);
      setActionMessage('Listing deleted successfully.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(msg || 'Failed to delete listing.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const openApproveModal = (listing: Listing) => {
    // Collect all images for preview — CDN images first, then raw URLs
    const previewImages: string[] = [];
    if (listing.productImages) {
      listing.productImages.forEach((pi) => { if (pi.cdnUrl) previewImages.push(pi.cdnUrl); });
    }
    if (listing.images) {
      listing.images.forEach((img) => { if (img && !previewImages.includes(img)) previewImages.push(img); });
    }
    setApproveModal({
      listingId: listing.id,
      title: listing.title,
      images: previewImages,
      placement: 'LATEST_COLLECTIONS',
      durationHours: '48',
    });
  };

  const handleApproveSubmit = async () => {
    if (!approveModal) return;
    setApproving(true);
    setActionError('');
    try {
      await api.put(`/admin/listings/${approveModal.listingId}/approve`, {
        placement: approveModal.placement,
        durationHours: parseInt(approveModal.durationHours) || 48,
      });
      setListings((prev) => prev.map((l) =>
        l.id === approveModal.listingId
          ? { ...l, status: 'ACTIVE', placement: approveModal.placement }
          : l
      ));
      setApproveModal(null);
      await fetchListings(search, statusFilter);
      setActionMessage('Listing approved successfully.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(msg || 'Failed to approve listing.');
    } finally {
      setApproving(false);
    }
  };

  const rejectListing = async (listingId: string) => {
    if (!confirm('Reject this listing?')) return;
    setActionLoadingId(listingId);
    setActionError('');
    try {
      await api.put(`/admin/listings/${listingId}/reject`);
      await fetchListings(search, statusFilter);
      setActionMessage('Listing rejected.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(msg || 'Failed to reject listing.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const toggleFeatured = async (listing: Listing) => {
    setActionLoadingId(listing.id);
    setActionError('');
    try {
      const isFeatured = listing.placement && listing.placement !== 'NONE';
      const payload = isFeatured
        ? { placement: 'NONE', placementExpiresAt: null }
        : {
            status: 'ACTIVE',
            placement: 'LATEST_COLLECTIONS',
            placementExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          };
      const { data } = await api.put(`/admin/listings/${listing.id}`, payload);
      setListings((prev) => prev.map((l) => l.id === listing.id ? { ...l, ...data } : l));
      setActionMessage(isFeatured ? 'Listing removed from featured.' : 'Listing marked as featured.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(msg || 'Failed to update featured status.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === listings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(listings.map((l) => l.id)));
    }
  };

  const handleBulkAction = async (action: BulkAction) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const label = action === 'delete' ? `delete ${ids.length} listing(s)` : `${action} ${ids.length} listing(s)`;
    if (!confirm(`Are you sure you want to ${label}?`)) return;
    setBulkLoading(true);
    setActionError('');
    try {
      await api.post('/admin/listings/bulk-action', { ids, action });
      setSelectedIds(new Set());
      await fetchListings(search, statusFilter);
      setActionMessage(`Bulk action "${action}" completed.`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(msg || 'Bulk action failed.');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleExportCSV = () => {
    const rows = selectedIds.size > 0
      ? listings.filter((l) => selectedIds.has(l.id))
      : listings;
    const headers = ['ID', 'Title', 'Seller', 'Price', 'Currency', 'Category', 'Status', 'Country', 'Created'];
    const csvContent = [
      headers.join(','),
      ...rows.map((l) =>
        [
          l.id,
          `"${(l.title || '').replace(/"/g, '""')}"`,
          `"${(l.user?.name || '').replace(/"/g, '""')}"`,
          l.price,
          l.currency,
          `"${(l.category?.name || '').replace(/"/g, '""')}"`,
          l.status,
          l.country,
          l.createdAt,
        ].join(',')
      ),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `listings-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || fetching) return <div className="p-8 text-center">Loading...</div>;

  const allSelected = listings.length > 0 && selectedIds.size === listings.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Listings</h1>
          <p className="text-gray-500 text-sm mt-0.5">{total} total listings</p>
        </div>
      </div>
      {actionMessage && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {actionError}
        </div>
      )}

      {/* Sticky filter + action bar */}
      <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm pt-2 pb-3 border-b border-gray-200 mb-4">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
          <input
            type="text"
            placeholder="Search by title or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending</option>
            <option value="SOLD">Sold</option>
            <option value="HIDDEN">Hidden</option>
            <option value="EXPIRED">Expired</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <div className="sm:ml-auto flex gap-2">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-50 transition-colors shadow-sm whitespace-nowrap"
            >
              📤 Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                    title="Select all"
                  />
                </th>
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-gray-600">Title</th>
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-gray-600">Seller</th>
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-gray-600">Price</th>
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-gray-600">Category</th>
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-gray-600">Placement</th>
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-gray-600">Posted</th>
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {listings.map((l) => (
                <tr
                  key={l.id}
                  className={`hover:bg-gray-50 transition-colors ${selectedIds.has(l.id) ? 'bg-sky-50' : ''}`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(l.id)}
                      onChange={() => toggleSelect(l.id)}
                      className="rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                    />
                  </td>
                  <td className="px-3 sm:px-4 py-3 max-w-[160px]">
                    <Link
                      href={`/listings/${l.id}`}
                      className="hover:text-sky-600 font-medium block truncate"
                      title={l.title}
                    >
                      {l.title}
                    </Link>
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-gray-500 max-w-[120px]">
                    <span className="block truncate" title={l.user?.name}>{l.user?.name}</span>
                  </td>
                  <td className="px-3 sm:px-4 py-3 whitespace-nowrap"><CurrencyDisplay amount={l.price} currency={l.currency} /></td>
                  <td className="px-3 sm:px-4 py-3 text-gray-500 max-w-[100px]">
                    <span className="block truncate" title={l.category?.name}>{l.category?.name}</span>
                  </td>
                  <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      l.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                      l.status === 'SOLD' ? 'bg-blue-100 text-blue-700' :
                      l.status === 'HIDDEN' ? 'bg-gray-100 text-gray-600' :
                      l.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>{l.status}</span>
                  </td>
                  <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                    {l.placement && l.placement !== 'NONE' ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700">
                        {l.placement === 'LATEST_COLLECTIONS' ? '⭐ Collections' :
                         l.placement === 'FEATURED_DEAL' ? '✦ FEATURED DEAL' :
                         l.placement === 'FLASH_SALE' ? '⚡ Flash' : l.placement}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(l.createdAt)}</td>
                  <td className="px-3 sm:px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {(l.status === 'PENDING' || l.status === 'ACTIVE') && (
                        <button
                          onClick={() => openApproveModal(l)}
                          disabled={actionLoadingId === l.id}
                          className="text-xs bg-sky-500 hover:bg-sky-600 text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => rejectListing(l.id)}
                        disabled={actionLoadingId === l.id}
                        className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => toggleFeatured(l)}
                        disabled={actionLoadingId === l.id}
                        className="text-xs bg-purple-500 hover:bg-purple-600 text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap disabled:opacity-50"
                      >
                        {l.placement && l.placement !== 'NONE' ? 'Unfeature' : 'Mark Feature'}
                      </button>
                      <select
                        value={l.status}
                        onChange={(e) => updateStatus(l.id, e.target.value)}
                        disabled={actionLoadingId === l.id}
                        className="text-xs border border-gray-200 rounded px-2 py-1.5"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="PENDING">Pending</option>
                        <option value="HIDDEN">Hidden</option>
                        <option value="EXPIRED">Expired</option>
                        <option value="REJECTED">Rejected</option>
                      </select>
                      <button
                        onClick={() => deleteListing(l.id, l.title)}
                        disabled={actionLoadingId === l.id}
                        className="text-red-500 hover:text-red-700 text-xs font-medium disabled:opacity-50"
                        title="Delete listing"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {listings.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                    No listings found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating bulk actions bar */}
      {someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-2xl border border-gray-700">
            <span className="text-sm font-semibold text-gray-300">
              {selectedIds.size} selected
            </span>
            <div className="w-px h-5 bg-gray-700" />
            <button
              onClick={() => handleBulkAction('approve')}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              ✅ Approve
            </button>
            <button
              onClick={() => handleBulkAction('feature')}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              ⭐ Mark Featured
            </button>
            <button
              onClick={() => handleBulkAction('reject')}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              🚫 Reject
            </button>
            <button
              onClick={() => handleBulkAction('delete')}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              🗑️ Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              title="Clear selection"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Approve & Place modal */}
      {approveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Approve & Place Listing</h2>
            <p className="text-sm text-gray-500 mb-4 truncate">{approveModal.title}</p>

            {/* ── Photo Preview ─────────────────────────────────────── */}
            {approveModal.images.length > 0 ? (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">
                  📸 Listing Images ({approveModal.images.length})
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {approveModal.images.map((src, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                      <Image
                        src={src.startsWith('http') ? src : `${getApiBaseUrl()}${src}`}
                        alt={`Listing image ${i + 1}`}
                        fill
                        className="object-cover"
                        sizes="120px"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                      {i === 0 && (
                        <span className="absolute top-1 left-1 bg-sky-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                          MAIN
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700 flex items-center gap-2">
                <span>⚠️</span>
                <span>No images uploaded for this listing. Review carefully before approving.</span>
              </div>
            )}

            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Section</label>
            <div className="flex flex-col gap-2 mb-4">
              {PLACEMENT_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="placement"
                    value={opt.value}
                    checked={approveModal.placement === opt.value}
                    onChange={(e) => setApproveModal((prev) => prev ? { ...prev, placement: e.target.value as Listing['placement'] } : prev)}
                    className="accent-sky-500"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>

            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Duration (hours)</label>
            <input
              type="number"
              min="1"
              max="8760"
              value={approveModal.durationHours}
              onChange={(e) => setApproveModal((prev) => prev ? { ...prev, durationHours: e.target.value } : prev)}
              placeholder="e.g. 48 (max 8760 = 1 year)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 mb-4"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setApproveModal(null)}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveSubmit}
                disabled={approving}
                className="flex-1 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {approving ? 'Approving…' : 'Approve & Place'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
