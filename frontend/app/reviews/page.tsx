'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

interface ReviewUser {
  id: string;
  name: string;
  avatar?: string | null;
}

interface ReviewListing {
  id: string;
  title: string;
}

interface Review {
  id: string;
  rating: number;
  title?: string | null;
  content: string;
  createdAt: string;
  helpfulCount: number;
  verifiedPurchase: boolean;
  user: ReviewUser;
  listing: ReviewListing;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const LIMIT = 4;

function StarDisplay({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          className={`${cls} ${s <= rating ? 'text-amber-400' : 'text-gray-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatReviewerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0]}.`;
}

export default function ReviewsPage() {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [ratingFilter, setRatingFilter] = useState<number | undefined>(undefined);
  const [sort, setSort] = useState<'recent' | 'highest' | 'lowest' | 'helpful'>('recent');
  const [page, setPage] = useState(1);

  const fetchReviews = useCallback(async (pg: number, rating?: number, sortBy?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pg),
        limit: String(LIMIT),
        sort: sortBy ?? 'recent',
      });
      if (rating) params.set('rating', String(rating));
      const res = await api.get(`/reviews/recent?${params}`);
      if (pg === 1) {
        setReviews(res.data.reviews);
      } else {
        setReviews((prev) => [...prev, ...res.data.reviews]);
      }
      setPagination(res.data.pagination);
    } catch {
      // silently fail — backend might not have reviews yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    fetchReviews(1, ratingFilter, sort);
  }, [ratingFilter, sort, fetchReviews]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchReviews(next, ratingFilter, sort);
  };

  const hasMore = pagination ? page < pagination.pages : false;

  return (
    <div className="min-h-screen bg-elite-cream/90 pb-16">
      {/* Hero header */}
      <div className="theme-header-bg py-5 px-4 text-white text-center">
        <h1 className="text-2xl sm:text-3xl font-extrabold mb-2">Community Reviews</h1>
        <p className="text-white/80 text-sm max-w-md mx-auto mb-6">
          Read honest reviews from our community or share your own experience.
        </p>
        {user ? (
          <Link
            href="/reviews/submit"
            className="inline-flex items-center gap-2 bg-elite-gold text-elite-navy font-bold px-6 py-3 rounded-xl hover:bg-elite-gold-light transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Write a Review
          </Link>
        ) : (
          <Link
            href="/auth/login?redirect=/reviews/submit"
            className="inline-flex items-center gap-2 bg-white/20 text-white font-bold px-6 py-3 rounded-xl hover:bg-white/30 transition-all text-sm border border-white/30"
          >
            Sign in to Write a Review
          </Link>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-sm font-semibold text-gray-600">Filter:</span>
          {[undefined, 5, 4, 3, 2, 1].map((r) => (
            <button
              key={r ?? 'all'}
              type="button"
              onClick={() => setRatingFilter(r)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                ratingFilter === r
                  ? 'bg-elite-navy text-white border-elite-navy'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-elite-navy hover:text-elite-navy'
              }`}
            >
              {r === undefined ? 'All' : (
                <>
                  {r}
                  <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </>
              )}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-600">Sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="text-xs font-semibold border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-elite-navy"
            >
              <option value="recent">Newest First</option>
              <option value="highest">Highest Rated</option>
              <option value="lowest">Lowest Rated</option>
              <option value="helpful">Most Helpful</option>
            </select>
          </div>
        </div>

        {/* Reviews list */}
        {loading && reviews.length === 0 ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gray-200" />
                  <div className="flex-1">
                    <div className="h-3 bg-gray-200 rounded w-32 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-20" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-gray-100 rounded" />
                  <div className="h-3 bg-gray-100 rounded w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">⭐</div>
            <h2 className="text-lg font-bold text-gray-700 mb-2">No reviews yet</h2>
            <p className="text-gray-500 text-sm mb-6">Be the first to share your experience!</p>
            <Link
              href="/reviews/submit"
              className="inline-flex items-center gap-2 bg-elite-navy text-white font-bold px-6 py-3 rounded-xl hover:bg-elite-charcoal transition-colors text-sm"
            >
              Write a Review
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <div key={review.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    {review.user.avatar ? (
                      <Image
                        src={review.user.avatar}
                        alt={review.user.name}
                        width={40}
                        height={40}
                        className="w-10 h-10 rounded-full object-cover border-2 border-elite-gold/30"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-elite-navy to-elite-charcoal flex items-center justify-center text-white font-bold text-sm">
                        {review.user.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{formatReviewerName(review.user.name)}</p>
                      <p className="text-[11px] text-gray-400">{timeAgo(review.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StarDisplay rating={review.rating} />
                    {review.verifiedPurchase && (
                      <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Verified
                      </span>
                    )}
                  </div>
                </div>

                {/* Listing link */}
                <Link
                  href={`/listings/${review.listing.id}`}
                  className="inline-flex items-center gap-1 text-[11px] text-elite-navy hover:text-elite-gold font-medium mb-2 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  {review.listing.title.length > 50 ? `${review.listing.title.slice(0, 50)}…` : review.listing.title}
                </Link>

                {/* Content */}
                {review.title && (
                  <h3 className="font-bold text-gray-900 text-sm mb-1">{review.title}</h3>
                )}
                <p className="text-gray-600 text-sm leading-relaxed">{review.content}</p>

                {/* Footer */}
                {review.helpfulCount > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                    <span className="text-xs text-gray-400">{review.helpfulCount} found this helpful</span>
                  </div>
                )}
              </div>
            ))}

            {/* Show more */}
            {hasMore && (
              <div className="text-center pt-4">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-semibold px-6 py-2.5 rounded-xl hover:border-elite-navy hover:text-elite-navy transition-all text-sm disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading…
                    </>
                  ) : (
                    <>
                      Show More
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </>
                  )}
                </button>
                {pagination && (
                  <p className="text-xs text-gray-400 mt-2">
                    Showing {reviews.length} of {pagination.total} reviews
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
