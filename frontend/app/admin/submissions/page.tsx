'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Listing, Placement } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { formatDate, resolveImageUrl } from '@/lib/utils';

interface ApprovalState {
  listingId: string;
  placement: Placement;
  durationHours: string;
}

const SUBMISSION_IMAGE_FALLBACK = '/apple-touch-icon.svg';

export default function AdminSubmissionsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [listings, setListings] = useState<Listing[]>([]);
  const [fetching, setFetching] = useState(true);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      setFetching(true);
      const { data } = await api.get('/admin/listings', { params: { status: 'PENDING' } });
      setListings(data.listings);
    } catch {
      // ignore
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'ADMIN') fetchPending();
  }, [user, fetchPending]);

  const openApproval = (listingId: string) => {
    setApproval({ listingId, placement: 'LATEST_COLLECTIONS', durationHours: '48' });
  };

  const handleApprove = async () => {
    if (!approval) return;
    setActionLoading(approval.listingId);
    try {
      await api.put(`/admin/listings/${approval.listingId}/approve`, {
        placement: approval.placement,
        durationHours: parseInt(approval.durationHours) || 48,
      });
      setApproval(null);
      await fetchPending();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (listingId: string) => {
    if (!confirm('Reject this listing? It will be hidden from the user\'s public view.')) return;
    setActionLoading(listingId);
    try {
      await api.put(`/admin/listings/${listingId}/reject`);
      await fetchPending();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  // Confirms payment for an ordinary user's requested Gold/Platinum tier
  // (see Listing.requestedTier) — deliberately separate from
  // handleApprove/handleReject above, since content approval and tier
  // payment are two different judgment calls an admin can make in either
  // order (see PUT /admin/listings/:id/tier).
  const handleConfirmTier = async (listingId: string, tier: 'GOLD' | 'PLATINUM' | 'FREE') => {
    setActionLoading(listingId);
    try {
      await api.put(`/admin/listings/${listingId}/tier`, { tier });
      await fetchPending();
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  if (loading || fetching) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Submissions</h1>
      <p className="text-gray-500 mb-6">
        Review pending user uploads and decide where they appear.
        {listings.length > 0 && <span className="ml-1 font-medium text-yellow-600">({listings.length} pending)</span>}
      </p>

      {listings.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-6 text-center">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-gray-500">No pending submissions to review.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.map((listing) => (
            <div
              key={listing.id}
              className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
            >
              {/* Image gallery */}
                <div className="aspect-[4/3] relative bg-gray-100 overflow-hidden">
                  {listing.images && listing.images.length > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImageUrl(listing.images[0])}
                    alt={listing.title}
                    className="h-full w-full object-cover"
                    onError={(event) => {
                      const img = event.currentTarget;
                      if (img.src.endsWith(SUBMISSION_IMAGE_FALLBACK)) return;
                      img.src = SUBMISSION_IMAGE_FALLBACK;
                    }}
                  />
                  ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={SUBMISSION_IMAGE_FALLBACK} alt="Submission placeholder" className="h-full w-full object-cover" />
                  )}
                <div className="absolute top-2 left-2">
                  <span className="bg-yellow-100 text-yellow-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    PENDING
                  </span>
                </div>
                {listing.images && listing.images.length > 1 && (
                  <div className="absolute bottom-2 right-2">
                    <span className="bg-black/50 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                      +{listing.images.length - 1} more
                    </span>
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="p-3">
                <h3 className="font-semibold text-gray-900 text-sm line-clamp-1">{listing.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{listing.description}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-bold text-red-600">
                    {listing.currency} {listing.price.toLocaleString('en-US')}
                  </span>
                  <span className="text-[10px] text-gray-400">{formatDate(listing.createdAt)}</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  by {listing.user?.name || 'Unknown'} · {listing.category?.name || ''}
                </p>

                {/* AI moderation flag (Module 1) — only shown when the
                    listing was actually flagged (flagged_category !==
                    'none'); an unflagged or never-checked listing shows
                    nothing extra here. This is informational for the
                    admin's own judgment call, not an instruction — the
                    Approve/Reject buttons below are unaffected by it. */}
                {listing.moderationFlaggedCategory && listing.moderationFlaggedCategory !== 'none' && (
                  <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5">
                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">
                      ⚠ AI flagged: {listing.moderationFlaggedCategory.replace('_', ' ')}
                      {listing.moderationConfidence != null && ` (${Math.round(listing.moderationConfidence * 100)}%)`}
                    </p>
                    {listing.moderationReason && (
                      <p className="text-[10px] text-amber-700 mt-0.5">{listing.moderationReason}</p>
                    )}
                  </div>
                )}

                {/* Requested tier payment confirmation — the seller picked
                    Gold/Platinum on the pre-post selector but nothing
                    promotes the listing until payment is confirmed here
                    (separate from the content Approve/Reject below; an
                    admin can do either first). */}
                {listing.requestedTier && (
                  <div className="mt-2 rounded-lg bg-violet-50 border border-violet-200 px-2 py-1.5">
                    <p className="text-[10px] font-bold text-violet-800 uppercase tracking-wide mb-1">
                      {listing.requestedTier === 'GOLD' ? '🥇 Gold' : '💎 Platinum'} requested — confirm payment
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleConfirmTier(listing.id, listing.requestedTier as 'GOLD' | 'PLATINUM')}
                        disabled={actionLoading === listing.id}
                        className="text-[10px] font-semibold px-2 py-1 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                      >
                        Confirm & activate
                      </button>
                      <button
                        onClick={() => handleConfirmTier(listing.id, 'FREE')}
                        disabled={actionLoading === listing.id}
                        className="text-[10px] font-semibold px-2 py-1 rounded-md border border-violet-300 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                      >
                        No payment — keep Free
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => openApproval(listing.id)}
                    disabled={actionLoading === listing.id}
                    className="flex-1 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(listing.id)}
                    disabled={actionLoading === listing.id}
                    className="flex-1 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Approval Modal ────────────────────────────────────────────── */}
      {approval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-scale-in">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Approve &amp; Place Listing</h2>
            <p className="text-sm text-gray-500 mb-4">Choose where this item will appear and for how long.</p>

            {/* Placement toggle */}
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Placement</label>
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setApproval({ ...approval, placement: 'LATEST_COLLECTIONS' })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  approval.placement === 'LATEST_COLLECTIONS'
                    ? 'bg-red-50 border-red-500 text-red-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                Latest Collections
              </button>
              <button
                type="button"
                onClick={() => setApproval({ ...approval, placement: 'FEATURED_DEAL' })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  approval.placement === 'FEATURED_DEAL'
                    ? 'bg-red-50 border-red-500 text-red-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                ✦ FEATURED DEAL
              </button>
            </div>

            {/* Duration */}
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Duration</label>
            <select
              value={approval.durationHours}
              onChange={(e) => setApproval({ ...approval, durationHours: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
            >
              <option value="24">24 Hours</option>
              <option value="48">48 Hours</option>
              <option value="72">72 Hours</option>
              <option value="168">7 Days</option>
              <option value="336">14 Days</option>
              <option value="720">30 Days</option>
            </select>

            {/* Modal actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setApproval(null)}
                className="flex-1 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={actionLoading !== null}
                className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
