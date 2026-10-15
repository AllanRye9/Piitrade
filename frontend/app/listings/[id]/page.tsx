'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Listing, ProductReview, ReviewAggregate } from '@/lib/types';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { timeAgo } from '@/lib/utils';

function StarRow({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <svg
          key={i}
          className={`w-4 h-4 ${i < rating ? 'text-amber-400' : 'text-gray-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { user } = useAuth();

  const [listing, setListing] = useState<Listing | null>(null);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [aggregate, setAggregate] = useState<ReviewAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [sort, setSort] = useState<'recent' | 'helpful' | 'highest' | 'lowest'>('recent');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [helpfulLoading, setHelpfulLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get(`/listings/${id}`)
      .then(({ data }) => setListing(data))
      .catch(() => setListing(null))
      .finally(() => setLoading(false));
  }, [id]);

  const fetchReviews = useCallback(async () => {
    if (!id) return;
    setReviewsLoading(true);
    try {
      const { data } = await api.get(`/reviews/listing/${id}`, {
        params: { sort, page, limit: 12 },
      });
      setReviews(data.reviews);
      setAggregate(data.aggregate);
      setTotalPages(data.pagination.pages);
    } catch {
      // ignore
    } finally {
      setReviewsLoading(false);
    }
  }, [id, sort, page]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const handleHelpful = async (reviewId: string) => {
    if (!user) return;
    setHelpfulLoading(reviewId);
    try {
      await api.post(`/reviews/${reviewId}/helpful`);
      fetchReviews();
    } catch {
      // ignore
    } finally {
      setHelpfulLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-3 animate-pulse space-y-3">
        <div className="h-4 shimmer rounded w-1/3" />
        <div className="h-32 shimmer rounded-2xl" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 shimmer rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!listing) {
    return (
        <div className="max-w-4xl mx-auto px-4 py-3 text-center">
        <p className="text-xl font-bold text-gray-800 mb-4">Listing not found</p>
        <Link href="/listings" className="text-red-600 hover:underline text-sm">
          Browse listings
        </Link>
      </div>
    );
  }

  return (
      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6 animate-fade-in">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Listings', href: '/listings' },
          { label: listing.title, href: `/listings/${id}` },
          { label: 'Reviews' },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Customer Reviews</h1>
          <p className="text-sm text-gray-500 mt-1">
            Reviews for{' '}
            <Link href={`/listings/${id}`} className="text-red-600 hover:underline font-medium">
              {listing.title}
            </Link>
          </p>
        </div>
        {user && (
          <Link
            href={`/listings/${id}/reviews/write`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Write a Review
          </Link>
        )}
      </div>

      {/* Aggregate Rating */}
      {aggregate && aggregate.total > 0 ? (
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm mb-6">
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <div className="text-center shrink-0">
              <div className="text-6xl font-extrabold text-gray-900 leading-none">
                {aggregate.averageRating.toFixed(1)}
              </div>
              <div className="flex justify-center gap-0.5 mt-2">
                <StarRow rating={Math.round(aggregate.averageRating)} />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {aggregate.total} review{aggregate.total !== 1 ? 's' : ''}
              </div>
            </div>

            <div className="flex-1 w-full space-y-1.5">
              {[5, 4, 3, 2, 1].map((s) => {
                const info = aggregate.breakdown[s] || { count: 0, pct: 0 };
                return (
                  <div key={s} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500 w-3 text-right">{s}</span>
                    <svg className="w-3 h-3 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full transition-all duration-500"
                        style={{ width: `${info.pct}%` }}
                      />
                    </div>
                    <span className="text-gray-400 w-6 text-right">{info.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-2xl p-5 text-center mb-4 border border-gray-100">
          <div className="text-4xl mb-3">💬</div>
          <p className="font-semibold text-gray-700 mb-1">No reviews yet</p>
          <p className="text-sm text-gray-500">Be the first to share your experience with this product.</p>
          {user && (
            <Link
              href={`/listings/${id}/reviews/write`}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
            >
              Write the first review
            </Link>
          )}
        </div>
      )}

      {/* Sort + Filter */}
      {reviews.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sort by:</span>
          {(['recent', 'helpful', 'highest', 'lowest'] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setSort(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                sort === s
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-700'
              }`}
            >
              {s === 'recent' ? 'Most Recent' : s === 'helpful' ? 'Most Helpful' : s === 'highest' ? 'Highest Rated' : 'Lowest Rated'}
            </button>
          ))}
        </div>
      )}

      {/* Review list */}
      {reviewsLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 shimmer rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar user={review.user} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{review.user?.name || 'Anonymous'}</p>
                      {review.verifiedPurchase && (
                        <span
                          title="This reviewer completed a purchase of this item"
                          className="inline-flex items-center gap-0.5 shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200"
                        >
                          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                          Verified Purchase
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{timeAgo(review.createdAt)}</p>
                  </div>
                </div>
                <div className="shrink-0">
                  <StarRow rating={review.rating} />
                </div>
              </div>

              {review.title && (
                <h3 className="font-semibold text-gray-800 text-sm mb-1">{review.title}</h3>
              )}
              <p className="text-sm text-gray-600 leading-relaxed">{review.content}</p>

              {/* Helpful vote */}
              <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-3">
                <span className="text-xs text-gray-400">Was this helpful?</span>
                <button
                  disabled={!user || helpfulLoading === review.id}
                  onClick={() => handleHelpful(review.id)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 transition-colors disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905a3.61 3.61 0 01-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                  </svg>
                  Yes ({review.helpfulCount ?? 0})
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-500 self-center">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {/* Back to product */}
      <div className="mt-4 text-center">
        <Link
          href={`/listings/${id}`}
          className="inline-flex items-center gap-2 text-sm text-red-600 hover:text-red-700 font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to product
        </Link>
      </div>
    </div>
  );
}
