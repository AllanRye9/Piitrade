'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Listing } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useAuth } from '@/context/AuthContext';

const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

export default function WriteReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [listing, setListing] = useState<Listing | null>(null);
  const [listingLoading, setListingLoading] = useState(true);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push(`/auth/login?redirect=/listings/${id}/reviews/write`);
  }, [user, authLoading, router, id]);

  useEffect(() => {
    if (!id) return;
    api.get(`/listings/${id}`)
      .then(({ data }) => setListing(data))
      .catch(() => setListing(null))
      .finally(() => setListingLoading(false));
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) { setError('Please select a rating.'); return; }
    if (!content.trim() || content.trim().length < 10) {
      setError('Please write at least 10 characters for your review.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api.post(`/reviews/listing/${id}`, {
        rating,
        title: title.trim() || undefined,
        content: content.trim(),
      });
      setSubmitted(true);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      if (status === 403) {
        setError(msg || "You can only review products you've purchased and received.");
      } else if (status === 409) {
        setError(msg || 'You have already reviewed this item.');
      } else {
        setError(msg || 'Failed to submit your review. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || listingLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-5 animate-pulse space-y-3">
        <div className="h-4 shimmer rounded w-1/3" />
        <div className="h-64 shimmer rounded-2xl" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 text-center">
        <p className="text-xl font-bold text-gray-800 mb-4">Listing not found</p>
        <Link href="/listings" className="text-red-600 hover:underline text-sm">Browse listings</Link>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 text-center animate-fade-in">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5 text-4xl">✅</div>
        <h1 className="text-2xl font-black text-gray-900 mb-2">Thank You!</h1>
        <p className="text-gray-600 mb-2 text-sm">
          Your review has been submitted and is awaiting moderation.
        </p>
        <p className="text-xs text-gray-400 mb-6">
          Once approved by our team it will appear on the product page.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={`/listings/${id}/reviews`}
            className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
          >
            View all reviews
          </Link>
          <Link
            href={`/listings/${id}`}
            className="px-6 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            Back to product
          </Link>
        </div>
      </div>
    );
  }

  return (
      <div className="max-w-2xl mx-auto px-4 py-4 sm:py-6 animate-fade-in">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Listings', href: '/listings' },
          { label: listing.title, href: `/listings/${id}` },
          { label: 'Reviews', href: `/listings/${id}/reviews` },
          { label: 'Write Review' },
        ]}
      />

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        <h1 className="text-2xl font-black text-gray-900 mb-1">Write a Review</h1>
        <p className="text-sm text-gray-500 mb-6">
          Share your experience with{' '}
          <Link href={`/listings/${id}`} className="text-red-600 hover:underline font-medium">
            {listing.title}
          </Link>
        </p>
        <div className="mb-6 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-2">
          <svg className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-emerald-800">
            To keep reviews trustworthy, only buyers who have completed and received an order for this item can leave a review. Your review will show a <span className="font-semibold">Verified Purchase</span> badge.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Star rating */}
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-3">
              Your Rating <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(s)}
                  className="p-0.5 transition-transform hover:scale-110 interactive"
                  aria-label={`${s} star${s !== 1 ? 's' : ''}`}
                >
                  <svg
                    className={`w-9 h-9 transition-colors ${s <= (hoverRating || rating) ? 'text-amber-400' : 'text-gray-200'}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </button>
              ))}
              {(hoverRating || rating) > 0 && (
                <span className="ml-1 text-sm text-gray-600 font-medium">
                  {RATING_LABELS[hoverRating || rating]}
                </span>
              )}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-1.5">
              Review Title <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={150}
              placeholder="Summarise your experience in a few words"
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 transition-shadow"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-bold text-gray-800 mb-1.5">
              Your Review <span className="text-red-500">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              minLength={10}
              maxLength={2000}
              rows={5}
              placeholder="Tell other buyers about your experience with this product — quality, accuracy of description, communication with the seller, etc."
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none transition-shadow"
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{content.length}/2000</p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors disabled:opacity-50 shadow-sm interactive"
            >
              {submitting ? 'Submitting…' : 'Submit Review'}
            </button>
            <Link
              href={`/listings/${id}/reviews`}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm text-center hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>

        {/* Guidelines */}
        <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl">
          <h3 className="text-xs font-bold text-red-800 mb-2">Review Guidelines</h3>
          <ul className="text-xs text-red-700 space-y-1">
            <li>• Be honest and helpful to other buyers</li>
            <li>• Focus on the product and your experience with the seller</li>
            <li>• Avoid personal information or offensive language</li>
            <li>• Reviews are moderated and may take up to 24 hours to appear</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
