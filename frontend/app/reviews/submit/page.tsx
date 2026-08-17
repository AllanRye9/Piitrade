'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Suspense } from 'react';

function StarSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          onMouseEnter={() => setHovered(s)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(s)}
          aria-label={`Rate ${s} star${s !== 1 ? 's' : ''}`}
          className="focus:outline-none transition-transform hover:scale-110 active:scale-95"
        >
          <svg
            className={`w-10 h-10 transition-colors ${
              (hovered || value) >= s ? 'text-amber-400' : 'text-gray-200'
            }`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </button>
      ))}
      {value > 0 && (
        <span className="ml-2 text-sm font-semibold text-amber-600">
          {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][value]}
        </span>
      )}
    </div>
  );
}

function SubmitReviewForm() {
  const { user } = useAuth();
  const params = useSearchParams();
  const prefillListingId = params?.get('listingId') ?? '';
  const prefillTitle = params?.get('title') ?? '';

  const [listingId, setListingId] = useState(prefillListingId);
  const [listingTitle, setListingTitle] = useState(prefillTitle);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!user) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-lg font-bold text-gray-700 mb-2">Sign in Required</h2>
        <p className="text-gray-500 text-sm mb-6">You must be signed in to write a review.</p>
        <Link
          href="/auth/login?redirect=/reviews/submit"
          className="inline-flex items-center gap-2 bg-premium-navy text-white font-bold px-6 py-3 rounded-xl hover:bg-premium-charcoal transition-colors text-sm"
        >
          Sign In to Continue
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-extrabold text-gray-900 mb-2">Thank You!</h2>
        <p className="text-gray-500 text-sm mb-2">Your review has been submitted and is pending moderation.</p>
        <p className="text-gray-400 text-xs mb-8">It will appear publicly once approved by our team.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/reviews"
            className="inline-flex items-center gap-2 bg-premium-navy text-white font-bold px-6 py-3 rounded-xl hover:bg-premium-charcoal transition-colors text-sm"
          >
            View All Reviews
          </Link>
          <button
            type="button"
            onClick={() => {
              setSuccess(false);
              setRating(0);
              setTitle('');
              setContent('');
              setListingId('');
              setListingTitle('');
            }}
            className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 font-bold px-6 py-3 rounded-xl hover:border-premium-navy hover:text-premium-navy transition-all text-sm"
          >
            Write Another Review
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!listingId.trim()) { setError('Please enter a listing ID or URL.'); return; }
    if (rating === 0) { setError('Please select a star rating.'); return; }
    if (content.trim().length < 10) { setError('Comment must be at least 10 characters.'); return; }

    // Extract listing ID from URL if user pasted a full URL
    let resolvedId = listingId.trim();
    const urlMatch = resolvedId.match(/\/listings\/([^/?#]+)/);
    if (urlMatch) resolvedId = urlMatch[1];

    setSubmitting(true);
    try {
      await api.post(`/reviews/listing/${resolvedId}`, {
        rating,
        title: title.trim() || undefined,
        content: content.trim(),
      });
      setSuccess(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Listing ID / URL */}
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1.5">
          Listing ID or URL <span className="text-red-500">*</span>
        </label>
        {listingTitle ? (
          <div className="flex items-center gap-3 p-3 bg-premium-navy/5 border border-premium-navy/20 rounded-xl">
            <svg className="w-4 h-4 text-premium-navy shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-premium-navy font-medium truncate flex-1">{listingTitle}</span>
            <button type="button" onClick={() => { setListingId(''); setListingTitle(''); }} className="text-gray-400 hover:text-red-500 text-xs shrink-0">Change</button>
          </div>
        ) : (
          <input
            type="text"
            value={listingId}
            onChange={(e) => setListingId(e.target.value)}
            placeholder="Paste listing URL or enter listing ID"
            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-premium-navy focus:border-transparent transition-all"
          />
        )}
        <p className="text-[11px] text-gray-400 mt-1">
          e.g. https://piitrade.com/listings/abc123 or just <code>abc123</code>
        </p>
      </div>

      {/* Star rating */}
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-2">
          Your Rating <span className="text-red-500">*</span>
        </label>
        <StarSelector value={rating} onChange={setRating} />
      </div>

      {/* Review title */}
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1.5">
          Review Title <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={150}
          placeholder="Summarise your experience in a headline"
          className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-premium-navy focus:border-transparent transition-all"
        />
      </div>

      {/* Comment */}
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-1.5">
          Your Review <span className="text-red-500">*</span>
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder="Share the details of your experience with this listing or seller…"
          className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-premium-navy focus:border-transparent transition-all resize-none"
        />
        <div className="flex justify-between mt-1">
          <p className="text-[11px] text-gray-400">Minimum 10 characters</p>
          <p className={`text-[11px] ${content.length > 1900 ? 'text-red-500' : 'text-gray-400'}`}>
            {content.length}/2000
          </p>
        </div>
      </div>

      {/* Privacy note */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
        <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-xs text-amber-700">
          Your review will be reviewed by our moderation team before being published. Your email and phone number will never be shown publicly.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
          <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <p className="text-xs text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 bg-premium-navy text-white font-bold px-6 py-3.5 rounded-xl hover:bg-premium-charcoal active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
      >
        {submitting ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Submitting…
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Submit Review
          </>
        )}
      </button>
    </form>
  );
}

export default function SubmitReviewPage() {
  return (
    <div className="min-h-screen bg-premium-cream/90 pb-16">
      {/* Header */}
      <div className="theme-header-bg py-4 px-4 text-white text-center">
        <h1 className="text-2xl font-extrabold mb-1">Write a Review</h1>
        <p className="text-white/80 text-sm">Share your experience with the community</p>
      </div>

      <div className="max-w-xl mx-auto px-4 py-4">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-gray-400 mb-6">
          <Link href="/" className="hover:text-premium-navy transition-colors">Home</Link>
          <span>/</span>
          <Link href="/reviews" className="hover:text-premium-navy transition-colors">Reviews</Link>
          <span>/</span>
          <span className="text-gray-600 font-medium">Write a Review</span>
        </nav>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
          <Suspense fallback={<div className="animate-pulse h-96 bg-gray-50 rounded-xl" />}>
            <SubmitReviewForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
