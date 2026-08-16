'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/api';
import { Listing, ProductReview, ReviewAggregate, User } from '@/lib/types';
import { CurrencyDisplay } from '@/components/ui/CurrencyDisplay';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { FavoriteButton } from '@/components/listings/FavoriteButton';
import { ListingCard } from '@/components/listings/ListingCard';
import { formatDate, resolveImageUrl, getCurrency } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useCountry } from '@/context/CountryContext';
import { useCart } from '@/context/CartContext';
import { useRouter } from 'next/navigation';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { getAccessToken } from '@/lib/authStorage';

/* ─────────────────────────────────────────────────────────────
   Helper to cast user object to User type
───────────────────────────────────────────────────────────── */
function asUser(obj: unknown): User {
  return obj as User;
}

/* ─────────────────────────────────────────────────────────────
   StructuredDescription
───────────────────────────────────────────────────────────── */
function StructuredDescription({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];

  const flushBullets = (key: string) => {
    if (!bulletBuffer.length) return;
    elements.push(
      <ul key={key} className="space-y-1.5 mb-3 pl-0">
        {bulletBuffer.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-[#4B5563]">
            <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-[#0EA5E9] shrink-0" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  };

  lines.forEach((line, i) => {
    const t = line.trim();
    if (/^##\s+/.test(t)) {
      flushBullets(`ul-${i}`);
      elements.push(<h4 key={i} className="text-sm font-semibold text-[#111827] mt-4 mb-1.5 first:mt-0">{t.replace(/^##\s+/, '')}</h4>);
    } else if (/^#\s+/.test(t)) {
      flushBullets(`ul-${i}`);
      elements.push(<h3 key={i} className="text-sm font-bold text-[#111827] mt-4 mb-2 first:mt-0 pb-1 border-b border-[#F3F4F6]">{t.replace(/^#\s+/, '')}</h3>);
    } else if (/^[-*]\s+/.test(t)) {
      bulletBuffer.push(t.replace(/^[-*]\s+/, ''));
    } else if (t === '') {
      flushBullets(`ul-${i}`);
    } else {
      flushBullets(`ul-${i}`);
      elements.push(<p key={i} className="text-sm text-[#4B5563] leading-relaxed mb-2">{t}</p>);
    }
  });
  flushBullets('ul-end');
  return <div>{elements}</div>;
}

/* ─────────────────────────────────────────────────────────────
   StarRating
───────────────────────────────────────────────────────────── */
function StarRating({ rating, max = 5, size = 'sm' }: { rating: number; max?: number; size?: 'xs' | 'sm' | 'md' }) {
  const sz = size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} className={`${sz} ${i < Math.round(rating) ? 'text-[#F59E0B]' : 'text-[#E5E7EB]'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Skeleton
───────────────────────────────────────────────────────────── */
function SkeletonPulse({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-[#F3F4F6] rounded-lg ${className}`} />;
}

function SkeletonDetail() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <SkeletonPulse className="h-4 w-72 mb-8" />
      <div className="grid lg:grid-cols-[1fr_400px] gap-8">
        <div className="space-y-4">
          <SkeletonPulse className="aspect-[4/3] rounded-2xl" />
          <div className="flex gap-2">
            {[...Array(5)].map((_, i) => <SkeletonPulse key={i} className="w-16 h-16 rounded-xl" />)}
          </div>
        </div>
        <div className="space-y-4">
          <SkeletonPulse className="h-8 w-3/4" />
          <SkeletonPulse className="h-10 w-1/2" />
          <SkeletonPulse className="h-32 rounded-xl" />
          <SkeletonPulse className="h-12 rounded-xl" />
          <SkeletonPulse className="h-12 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Badge variants
───────────────────────────────────────────────────────────── */
function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'new' | 'used' | 'active' | 'sold' | 'low' | 'out' }) {
  const styles: Record<string, string> = {
    default: 'bg-[#F3F4F6] text-[#374151]',
    new: 'bg-[#ECFDF5] text-[#065F46]',
    used: 'bg-[#FEF3C7] text-[#92400E]',
    active: 'bg-[#DCFCE7] text-[#166534]',
    sold: 'bg-[#FEE2E2] text-[#991B1B]',
    low: 'bg-[#FEF3C7] text-[#92400E]',
    out: 'bg-[#FEE2E2] text-[#991B1B]',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${styles[variant]}`}>
      {children}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   SectionCard
───────────────────────────────────────────────────────────── */
function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[#F3F4F6]">
      <span className="text-[#0EA5E9]">{icon}</span>
      <h2 className="text-sm font-semibold text-[#111827]">{title}</h2>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main Component
───────────────────────────────────────────────────────────── */
const DESCRIPTION_COLLAPSE_THRESHOLD = 300;

export default function ListingDetailClient() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { user } = useAuth();
  const { addToCart } = useCart();
  const router = useRouter();
  const { country: selectedCountry } = useCountry();
  const displayCurrency = getCurrency(selectedCountry);

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());
  const [cartAdded, setCartAdded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [relatedListings, setRelatedListings] = useState<Listing[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [qty, setQty] = useState(1);
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});

  // Fix: Type assertion for productOptions (not yet in Listing type)
  const dynamicOptions = (listing as unknown as { productOptions?: { name: string; values: string[] }[] })?.productOptions ?? null;  const colorOptions = dynamicOptions?.find((o) => /colou?r/i.test(o.name))?.values ?? ['Black', 'Brown', 'Tan'];
  const sizeOptions  = dynamicOptions?.find((o) => /size/i.test(o.name))?.values  ?? ['XS', 'S', 'M', 'L', 'XL'];

  const cartAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewStartRef = useRef<number | null>(null);
  const engagementSentRef = useRef(false);
  const autoScrollInterval = useRef<NodeJS.Timeout | null>(null);
  const touchStartX = useRef<number>(0);

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareText = `Check out ${listing?.title} on 3relite!`;
  const socialShares = [
    {
      name: 'Facebook', icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" /></svg>
      ), url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      name: 'Twitter / X', icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
      ), url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
    },
    {
      name: 'WhatsApp', icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.99 2C6.477 2 2 6.477 2 12c0 1.778.465 3.45 1.28 4.9L2 22l5.237-1.257A9.956 9.956 0 0011.99 22C17.513 22 22 17.523 22 12c0-5.516-4.483-9.996-10.01-10z" fillRule="evenodd" clipRule="evenodd"/></svg>
      ), url: `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`,
    },
    {
      // TikTok has no public web share-intent URL, so sharing falls back to
      // copying the link for the user to paste into the TikTok app.
      name: 'TikTok', icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M16.5 2h-3.2v13.6a2.9 2.9 0 11-2.06-2.78V9.6a6.1 6.1 0 105.26 6.04V8.3a7.6 7.6 0 004.5 1.46V6.55A4.3 4.3 0 0116.5 2z"/></svg>
      ), url: shareUrl, copy: true,
    },
    {
      // Instagram doesn't support a URL-based share intent either, so this
      // also copies the link for pasting into an Instagram post/DM/story.
      name: 'Instagram', icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.5" y2="6.5"/></svg>
      ), url: shareUrl, copy: true,
    },
    {
      name: 'Copy link', icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round"/></svg>
      ), url: shareUrl, copy: true,
    },
  ];

  const [copiedShareName, setCopiedShareName] = useState<string | null>(null);

  // Wrapped in useCallback to prevent re-creation on every render (fixes exhaustive-deps warning)
  const nextImage = useCallback(() => {
    const len = listing?.productImages?.length || listing?.images?.length || 0;
    if (len === 0) return;
    setActiveImage((prev) => (prev + 1) % len);
  }, [listing]);

  const prevImage = useCallback(() => {
    const len = listing?.productImages?.length || listing?.images?.length || 0;
    if (len === 0) return;
    setActiveImage((prev) => (prev - 1 + len) % len);
  }, [listing]);

  const startAutoScroll = useCallback(() => {
    if (autoScrollInterval.current) clearInterval(autoScrollInterval.current);
    const len = listing?.productImages?.length || listing?.images?.length || 0;
    if (len <= 1) return;
    autoScrollInterval.current = setInterval(() => nextImage(), 5000);
  }, [listing, nextImage]);

  const stopAutoScroll = () => {
    if (autoScrollInterval.current) { clearInterval(autoScrollInterval.current); autoScrollInterval.current = null; }
  };

  const pauseRestart = useCallback(() => {
    stopAutoScroll();
    const t = setTimeout(() => startAutoScroll(), 6000);
    return () => clearTimeout(t);
  }, [startAutoScroll]);

  const goToImage = (i: number) => { setActiveImage(i); pauseRestart(); };
  const len = listing?.productImages?.length || listing?.images?.length || 0;

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; stopAutoScroll(); };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 50 && len > 1) {
      if (delta > 0) { prevImage(); } else { nextImage(); }
    }
    touchStartX.current = 0;
    pauseRestart();
  };

  useEffect(() => () => {
    if (cartAddedTimerRef.current) clearTimeout(cartAddedTimerRef.current);
    if (autoScrollInterval.current) clearInterval(autoScrollInterval.current);
  }, []);

  useEffect(() => {
    if (!zoomOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomOpen(false);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); nextImage(); }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); prevImage(); }
    };
    window.addEventListener('keydown', h);
    // Lock body scroll while fullscreen is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [zoomOpen, nextImage, prevImage]);

  useEffect(() => {
    api.get(`/listings/${id}`).then(({ data }) => setListing(data)).catch(() => setListing(null)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (listing && len > 1) startAutoScroll();
    return () => stopAutoScroll();
  }, [listing, startAutoScroll, len]);

  useEffect(() => {
    if (!listing) return;
    viewStartRef.current = Date.now();
    engagementSentRef.current = false;
    setRelatedLoading(true);
    api.get('/listings', { params: { category: listing.category.slug, limit: 8 } })
      .then(({ data }) => setRelatedListings((data.listings as Listing[]).filter(l => l.id !== listing.id).slice(0, 6)))
      .catch(() => {})
      .finally(() => setRelatedLoading(false));
  }, [listing]);

  useEffect(() => {
    if (!listing?.id) return;
    const flush = () => {
      if (engagementSentRef.current) return;
      const start = viewStartRef.current;
      if (!start) return;
      const dur = Math.floor((Date.now() - start) / 1000);
      if (dur < 3) return;
      engagementSentRef.current = true;
      const token = getAccessToken();
      void fetch(`${API_URL}/api/listings/${listing.id}/engagement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ durationSeconds: dur }),
        keepalive: true,
        credentials: 'include',
      }).catch(() => { engagementSentRef.current = false; });
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { flush(); window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', onVis); };
  }, [listing?.id]);

  // Reviews
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [aggregate, setAggregate] = useState<ReviewAggregate | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewSort, setReviewSort] = useState<'recent' | 'helpful' | 'highest' | 'lowest'>('recent');
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewTotalPages, setReviewTotalPages] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [formRating, setFormRating] = useState(0);
  const [formHoverRating, setFormHoverRating] = useState(0);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [helpfulLoading, setHelpfulLoading] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    if (!id) return;
    setReviewsLoading(true);
    try {
      const { data } = await api.get(`/reviews/listing/${id}`, { params: { sort: reviewSort, page: reviewPage, limit: 10 } });
      setReviews(data.reviews);
      setAggregate(data.aggregate);
      setReviewTotalPages(data.pagination.pages);
    } catch { /* ignore */ }
    finally { setReviewsLoading(false); }
  }, [id, reviewSort, reviewPage]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRating) { setFormError('Please select a rating.'); return; }
    if (!formContent.trim()) { setFormError('Please write your review.'); return; }
    setFormError('');
    setFormSubmitting(true);
    try {
      await api.post(`/reviews/listing/${id}`, { rating: formRating, title: formTitle || undefined, content: formContent });
      setFormSuccess('Thank you! Your review has been submitted.');
      setShowForm(false);
      setFormRating(0); setFormTitle(''); setFormContent('');
      fetchReviews();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setFormError(msg || 'Failed to submit review. Please try again.');
    } finally { setFormSubmitting(false); }
  };

  const handleHelpful = async (reviewId: string) => {
    if (!user) return;
    setHelpfulLoading(reviewId);
    try { await api.post(`/reviews/${reviewId}/helpful`); fetchReviews(); }
    catch { /* ignore */ }
    finally { setHelpfulLoading(null); }
  };

  if (loading) return <SkeletonDetail />;
  if (!listing) return (
    <div className="max-w-7xl mx-auto px-4 py-20 text-center">
      <div className="text-6xl mb-4">🔍</div>
      <h2 className="text-xl font-semibold text-[#111827] mb-2">Listing not found</h2>
      <p className="text-[#6B7280] mb-6">This listing may have been removed or is no longer available.</p>
      <Link href="/listings" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0EA5E9] text-white rounded-xl font-medium text-sm">
        Browse all listings
      </Link>
    </div>
  );

  const images = (() => {
    const cdn = (listing.productImages || []).filter(pi => pi.cdnUrl).map(pi => resolveImageUrl(pi.cdnUrl as string));
    if (cdn.length) return cdn;
    if (listing.images.length) return listing.images.map(resolveImageUrl);
    return [];
  })();

  const stockStatus = typeof listing.stock === 'number'
    ? listing.stock > 10 ? { label: 'In Stock', variant: 'active' as const }
    : listing.stock > 0 ? { label: `Only ${listing.stock} left`, variant: 'low' as const }
    : { label: 'Out of Stock', variant: 'out' as const }
    : null;

  const contactLabelMap: Record<string, string> = { ADMIN: 'Purchase', AGENT: 'Contact Agent', COMPANY: 'Contact Company', ORGANIZATION: 'Contact Company' };
  const contactLabel = contactLabelMap[listing.user.role ?? ''] ?? 'Contact Seller';

  const detailItems = [
    { label: 'Category', value: listing.category.name, icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg> },
    { label: 'Condition', value: listing.condition, icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
    { label: 'Location', value: `${listing.location}, ${listing.country}`, icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg> },
    { label: 'Views', value: listing.views?.toString() || '0', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> },
    { label: 'Listed', value: formatDate(listing.createdAt), icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> },
    { label: 'Listing ID', value: `#${listing.id.slice(0, 8).toUpperCase()}`, icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" /></svg> },
  ];

  // Category-specific custom field answers (Category.fieldSchema, configured
  // under /admin/categories "Custom Fields") — only fields with a saved,
  // non-blank answer are shown.
  const customFieldItems = (listing.category.fieldSchema ?? [])
    .map((field) => ({ label: field.label, value: listing.customFieldValues?.[field.name] }))
    .filter((item): item is { label: string; value: string } => !!item.value && item.value.trim() !== '');

  return (
    <div className="bg-[#F9FAFB] min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* Breadcrumb */}
        <div className="mb-5">
          <Breadcrumb
            items={[
              { label: 'Home', href: '/' },
              { label: 'Listings', href: '/listings' },
              { label: listing.category.name, href: `/listings?category=${listing.category.slug}` },
              { label: listing.title },
            ]}
          />
        </div>

        <div className="grid lg:grid-cols-[1fr_380px] gap-6">
          {/* ─── LEFT ─── */}
          <div className="space-y-5">

            {/* Image Gallery — vertical thumbs left, compact main image right */}
            <SectionCard className="overflow-hidden">
              <div className="flex">
                {images.length > 1 && (
                  <div
                    className="flex flex-col gap-1.5 p-2 bg-[#F9FAFB] border-r border-[#F3F4F6] overflow-hidden shrink-0"
                    style={{ width: '68px', maxHeight: '396px' }}
                  >
                    {images.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => goToImage(i)}
                        aria-label={`View image ${i + 1}`}
                        className={`relative shrink-0 rounded-lg overflow-hidden transition-all ${i === activeImage ? 'ring-2 ring-[#0EA5E9] ring-offset-1 opacity-100' : 'opacity-50 hover:opacity-80'}`}
                        style={{ width: '52px', height: '52px' }}
                      >
                        <Image src={img} alt={`Thumbnail ${i + 1}`} fill className="object-cover" sizes="52px" />
                      </button>
                    ))}
                  </div>
                )}

                <div
                  className="relative bg-[#F3F4F6] touch-pan-y flex-1 ml-2 overflow-hidden rounded-xl"
                  style={{ minHeight: '320px', maxHeight: '520px' }}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                >
                  {images.length === 0 || failedImages.has(activeImage) ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#F9FAFB]">
                      <svg className="w-14 h-14 text-[#D1D5DB]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      <p className="text-sm text-[#9CA3AF]">No image available</p>
                    </div>
                  ) : (
                    <button type="button" aria-label="Open image fullscreen" className="w-full h-full cursor-zoom-in group flex items-center justify-center bg-gray-50" onClick={() => setZoomOpen(true)}>
                      <Image
                        src={images[activeImage]}
                        alt={listing.title}
                        width={800}
                        height={600}
                        className="object-contain w-full h-auto max-h-[500px]"
                        unoptimized
                        onError={() => setFailedImages((p) => { const s = new Set(p); s.add(activeImage); return s; })}
                      />
                      <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 bg-black/50 text-white text-[11px] font-medium px-2.5 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                        Fullscreen
                      </span>
                    </button>
                  )}

                  {listing.status === 'SOLD' && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
                      <span className="text-white font-black text-2xl tracking-widest border-4 border-white px-6 py-2 rounded-xl -rotate-6 uppercase">Sold</span>
                    </div>
                  )}

                  {images.length > 1 && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); prevImage(); }} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-[#374151] flex items-center justify-center shadow-sm transition-all hover:scale-105">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); nextImage(); }} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-[#374151] flex items-center justify-center shadow-sm transition-all hover:scale-105">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                      </button>
                      <div className="absolute bottom-3 right-3 bg-black/50 text-white text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
                        {activeImage + 1} / {images.length}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* Options – Dynamic Product Options */}
            <SectionCard>
              <SectionHeader icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>} title="Product Options" />
              <div className="p-5 grid sm:grid-cols-2 gap-5">
                {dynamicOptions && dynamicOptions.length > 0 ? (
                  dynamicOptions.map((opt) => {
                    const isColor = /colou?r/i.test(opt.name);
                    const isSize  = /size/i.test(opt.name);
                    const currentVal = isColor ? selectedColor : isSize ? selectedSize : (selectedOptions[opt.name] ?? '');
                    const setValue = (v: string) => {
                      if (isColor) setSelectedColor(v);
                      else if (isSize) setSelectedSize(v);
                      else setSelectedOptions((prev) => ({ ...prev, [opt.name]: v }));
                    };
                    return (
                      <div key={opt.name}>
                        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2.5">
                          {opt.name}{currentVal ? ` — ` : ''}<span className="text-[#111827] normal-case font-medium">{currentVal}</span>
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {opt.values.map((v) => (
                            <button key={v} type="button" onClick={() => setValue(v)} className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${currentVal === v ? 'border-[#0EA5E9] bg-[#EFF6FF] text-[#0369A1]' : 'border-[#E5E7EB] text-[#374151] hover:border-[#9CA3AF]'}`}>{v}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <>
                    <div>
                      <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2.5">Colour — <span className="text-[#111827] normal-case font-medium">{selectedColor}</span></p>
                      <div className="flex flex-wrap gap-2">
                        {colorOptions.map(c => (
                          <button key={c} type="button" onClick={() => setSelectedColor(c)} className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${selectedColor === c ? 'border-[#0EA5E9] bg-[#EFF6FF] text-[#0369A1]' : 'border-[#E5E7EB] text-[#374151] hover:border-[#9CA3AF]'}`}>{c}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2.5">Size</p>
                      <select
                        value={selectedSize}
                        onChange={e => setSelectedSize(e.target.value)}
                        className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-sm font-medium text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent cursor-pointer"
                      >
                        {sizeOptions.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </SectionCard>

            {/* Description */}
            <SectionCard>
              <SectionHeader icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>} title="Product Description" />
              <div className="p-5">
                <div className={`overflow-hidden transition-all duration-300 ${descExpanded ? '' : 'max-h-36'}`}>
                  <StructuredDescription text={listing.description} />
                </div>
                {listing.description.length > DESCRIPTION_COLLAPSE_THRESHOLD && (
                  <button onClick={() => setDescExpanded(p => !p)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#0EA5E9] hover:text-[#0284C7] transition-colors">
                    {descExpanded ? (
                      <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>Show less</>
                    ) : (
                      <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>Read more</>
                    )}
                  </button>
                )}
              </div>
            </SectionCard>

            {/* Listing Details */}
            <SectionCard>
              <SectionHeader icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>} title="Listing Details" />
              <div className="p-5">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {detailItems.map(({ label, value, icon }) => (
                    <div key={label} className="bg-[#F9FAFB] rounded-xl p-3.5 border border-[#F3F4F6]">
                      <dt className="flex items-center gap-1.5 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">
                        <span className="text-[#9CA3AF]">{icon}</span>
                        {label}
                      </dt>
                      <dd className="text-sm font-semibold text-[#111827] truncate">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </SectionCard>

            {/* Category-specific details (admin-defined custom fields) */}
            {customFieldItems.length > 0 && (
              <SectionCard>
                <SectionHeader icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>} title={`${listing.category.name} Details`} />
                <div className="p-5">
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {customFieldItems.map(({ label, value }) => (
                      <div key={label} className="bg-[#F9FAFB] rounded-xl p-3.5 border border-[#F3F4F6]">
                        <dt className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">{label}</dt>
                        <dd className="text-sm font-semibold text-[#111827] truncate">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </SectionCard>
            )}

            {/* Share */}
            <SectionCard>
              <SectionHeader icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>} title="Share this listing" />
              <div className="p-5">
                <div className="flex items-center gap-2 flex-wrap">
                  {socialShares.map((s) => (
                    <button
                      key={s.name}
                      onClick={async () => {
                        if ((s as { copy?: boolean }).copy) {
                          await navigator.clipboard.writeText(shareUrl);
                          setCopiedShareName(s.name);
                          setTimeout(() => setCopiedShareName(null), 2000);
                        } else {
                          window.open(s.url, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium bg-[#F9FAFB] border border-[#E5E7EB] text-[#374151] hover:bg-[#F3F4F6] hover:border-[#D1D5DB] transition-all"
                      aria-label={`Share on ${s.name}`}
                    >
                      <span className="text-[#6B7280]">{s.icon}</span>
                      {(s as { copy?: boolean }).copy && copiedShareName === s.name ? 'Copied!' : s.name}
                    </button>
                  ))}
                </div>
              </div>
            </SectionCard>
          </div>

          {/* ─── RIGHT ─── */}
          <div className="space-y-4">

            {/* Price + Title card */}
            <SectionCard className="shadow-sm">
              <div className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <CurrencyDisplay amount={listing.price} currency={listing.currency} displayCurrency={displayCurrency} showOriginal={displayCurrency !== listing.currency} className="text-3xl font-extrabold text-[#0369A1] leading-none" />
                  <FavoriteButton listingId={listing.id} />
                </div>
                <h1 className="text-lg font-bold text-[#111827] leading-snug mb-3">{listing.title}</h1>

                <div className="flex items-center gap-1.5 text-[#6B7280] text-xs mb-3">
                  <svg className="w-3.5 h-3.5 shrink-0 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  {listing.location}, {listing.country}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={listing.condition === 'NEW' ? 'new' : 'used'}>
                    {listing.condition === 'NEW' ? (
                      <><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>New</>
                    ) : '◑ Used'}
                  </Badge>
                  {listing.status === 'ACTIVE' && <Badge variant="active"><span className="w-1.5 h-1.5 rounded-full bg-current" />Active</Badge>}
                  {stockStatus && <Badge variant={stockStatus.variant}>{stockStatus.label}</Badge>}
                </div>

                {aggregate && aggregate.total > 0 && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F3F4F6]">
                    <StarRating rating={aggregate.averageRating} size="sm" />
                    <span className="text-sm font-semibold text-[#111827]">{aggregate.averageRating.toFixed(1)}</span>
                    <span className="text-xs text-[#9CA3AF]">({aggregate.total} {aggregate.total === 1 ? 'review' : 'reviews'})</span>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Purchase Actions */}
            {listing.status === 'ACTIVE' && (
              <SectionCard className="shadow-sm">
                <div className="p-5">
                  <h3 className="text-sm font-semibold text-[#374151] mb-4">{contactLabel}</h3>

                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Qty</span>
                    <div className="flex items-center border border-[#E5E7EB] rounded-xl overflow-hidden">
                      <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-10 h-10 flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                      </button>
                      <span className="w-10 text-center text-sm font-semibold text-[#111827]">{qty}</span>
                      <button onClick={() => setQty(q => q + 1)} className="w-10 h-10 flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                      </button>
                    </div>
                    {typeof listing.stock === 'number' && <span className="text-xs text-[#9CA3AF]">of {listing.stock} available</span>}
                  </div>

                  <div className="space-y-2.5">
                    <button
                      onClick={() => {
                        addToCart(listing, {
                          color: selectedColor,
                          size:  selectedSize,
                          attributes: {
                            ...(listing.motorDetails ? {
                              make:         listing.motorDetails.make         || '',
                              model:        listing.motorDetails.model        || '',
                              color:        listing.motorDetails.color        || selectedColor,
                              transmission: listing.motorDetails.transmission || '',
                            } : {}),
                            ...selectedOptions,
                          },
                        });
                        setCartAdded(true);
                        if (cartAddedTimerRef.current) clearTimeout(cartAddedTimerRef.current);
                        cartAddedTimerRef.current = setTimeout(() => setCartAdded(false), 2500);
                      }}
                      className={`w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                        cartAdded
                          ? 'bg-[#10B981] text-white'
                          : 'bg-white border-2 border-[#0EA5E9] text-[#0EA5E9] hover:bg-[#EFF6FF]'
                      }`}
                    >
                      {cartAdded ? (
                        <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Added to Cart!</>
                      ) : (
                        <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>Add to Cart</>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        addToCart(listing, {
                          color: selectedColor,
                          size:  selectedSize,
                          attributes: {
                            ...(listing.motorDetails ? {
                              make:         listing.motorDetails.make         || '',
                              model:        listing.motorDetails.model        || '',
                              color:        listing.motorDetails.color        || selectedColor,
                              transmission: listing.motorDetails.transmission || '',
                            } : {}),
                            ...selectedOptions,
                          },
                        });
                        router.push('/checkout');
                      }}
                      className="w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-[#0EA5E9] hover:bg-[#0284C7] text-white transition-all active:scale-[0.98]"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      Buy Now
                    </button>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Seller Card */}
            <SectionCard className="shadow-sm">
              <SectionHeader icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>} title="Seller Information" />
              <div className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <UserAvatar user={asUser(listing.user)} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-[#111827] text-sm truncate">{listing.user.name}</p>
                      {listing.user.isVerified && (
                        <span className="inline-flex items-center gap-1 bg-[#EFF6FF] text-[#1D4ED8] text-[10px] font-bold px-2 py-0.5 rounded-full">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                          Verified
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#9CA3AF] mt-0.5">Member since {formatDate(listing.createdAt)}</p>
                  </div>
                </div>

                {listing.user.phone && (
                  <div className="space-y-2 border-t border-[#F3F4F6] pt-4">
                    <p className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider">Contact Seller</p>
                    <a href={`tel:${listing.user.phone}`} className="flex items-center gap-2.5 p-3 rounded-xl bg-[#F9FAFB] border border-[#F3F4F6] hover:border-[#E5E7EB] transition-all text-sm font-medium text-[#374151]">
                      <svg className="w-4 h-4 text-[#0EA5E9]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                      {listing.user.phone}
                    </a>
                    <a href={`https://wa.me/${listing.user.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi, I'm interested in your listing: ${listing.title}`)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 p-3 rounded-xl bg-[#F0FDF4] border border-[#DCFCE7] hover:border-[#BBF7D0] transition-all text-sm font-medium text-[#15803D]">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM11.99 2C6.477 2 2 6.477 2 12c0 1.778.465 3.45 1.28 4.9L2 22l5.237-1.257A9.956 9.956 0 0011.99 22C17.513 22 22 17.523 22 12c0-5.516-4.483-9.996-10.01-10z" /></svg>
                      WhatsApp
                    </a>
                  </div>
                )}

                <Link
                  href={listing.user?.store?.slug
                    ? `/stores/${listing.user.store.slug}`
                    : `/listings?userId=${listing.userId}`}
                  className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-[#0EA5E9] hover:text-[#0284C7] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0l-4-4m4 4l-4 4" /></svg>
                  {listing.user?.store?.slug ? 'Visit Seller Store' : 'View all listings by this seller'}
                </Link>
              </div>
            </SectionCard>

            {/* Safety Tips */}
            <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div>
                  <p className="text-xs font-bold text-[#92400E] mb-1.5">Safety Tips</p>
                  <ul className="text-[11px] text-[#B45309] space-y-1">
                    <li className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[#D97706]" />Meet in a safe, public location</li>
                    <li className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[#D97706]" />Never pay in advance without inspecting</li>
                    <li className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-[#D97706]" />Trust your instincts</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Report */}
            <Link href={`/reports/create?listingId=${listing.id}&title=${encodeURIComponent(listing.title)}`} className="flex items-center justify-center gap-1.5 py-2.5 text-xs text-[#9CA3AF] hover:text-[#EF4444] transition-colors rounded-xl hover:bg-[#FEF2F2]">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
              Report this listing
            </Link>
          </div>
        </div>

        {/* ─── Reviews Section ─── */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-[#111827] flex items-center gap-2">
              <svg className="w-5 h-5 text-[#F59E0B]" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              Customer Reviews
            </h2>
            <Link href={`/listings/${id}/reviews`} className="text-xs font-semibold text-[#0EA5E9] hover:text-[#0284C7] flex items-center gap-1">
              View all
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>

          {/* Aggregate */}
          {aggregate && aggregate.total > 0 && (
            <SectionCard className="mb-6">
              <div className="p-6 flex flex-col sm:flex-row gap-6 items-start sm:items-center">
                <div className="text-center shrink-0 px-4">
                  <div className="text-5xl font-black text-[#111827]">{aggregate.averageRating.toFixed(1)}</div>
                  <StarRating rating={aggregate.averageRating} size="md" />
                  <div className="text-xs text-[#9CA3AF] mt-1.5">{aggregate.total} {aggregate.total === 1 ? 'review' : 'reviews'}</div>
                </div>
                <div className="flex-1 w-full space-y-2">
                  {[5, 4, 3, 2, 1].map(s => {
                    const info = aggregate.breakdown[s] || { count: 0, pct: 0 };
                    return (
                      <div key={s} className="flex items-center gap-3 text-xs">
                        <span className="text-[#374151] font-semibold w-2">{s}</span>
                        <svg className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                        <div className="flex-1 h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
                          <div className="h-full bg-[#F59E0B] rounded-full transition-all duration-700" style={{ width: `${info.pct}%` }} />
                        </div>
                        <span className="text-[#9CA3AF] w-6 text-right">{info.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </SectionCard>
          )}

          {/* Success Message */}
          {formSuccess && (
            <div className="flex items-center gap-3 bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] rounded-xl p-4 mb-5 text-sm">
              <svg className="w-5 h-5 shrink-0 text-[#10B981]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
              {formSuccess}
            </div>
          )}

          {/* Review Form Toggle */}
          {user && !formSuccess && (
            <div className="mb-6">
              {!showForm ? (
                <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0EA5E9] text-white text-sm font-semibold hover:bg-[#0284C7] transition-all">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Write a Review
                </button>
              ) : (
                <SectionCard>
                  <SectionHeader icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>} title="Write Your Review" />
                  <form onSubmit={handleReviewSubmit} className="p-5 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#374151] mb-2">Rating *</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(s => (
                          <button key={s} type="button" onMouseEnter={() => setFormHoverRating(s)} onMouseLeave={() => setFormHoverRating(0)} onClick={() => setFormRating(s)} className="p-0.5">
                            <svg className={`w-8 h-8 transition-colors ${s <= (formHoverRating || formRating) ? 'text-[#F59E0B]' : 'text-[#E5E7EB]'}`} fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                          </button>
                        ))}
                      </div>
                    </div>
                    <input type="text" value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Review title (optional)" className="w-full rounded-xl border border-[#E5E7EB] px-3.5 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent" />
                    <textarea value={formContent} onChange={e => setFormContent(e.target.value)} rows={4} placeholder="Share your experience with this product…" className="w-full rounded-xl border border-[#E5E7EB] px-3.5 py-2.5 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent resize-none" required />
                    {formError && (
                      <p className="flex items-center gap-1.5 text-xs text-[#DC2626]">
                        <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                        {formError}
                      </p>
                    )}
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => { setShowForm(false); setFormError(''); }} className="px-4 py-2.5 rounded-xl text-sm font-medium text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB]">Cancel</button>
                      <button type="submit" disabled={formSubmitting} className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[#0EA5E9] text-white hover:bg-[#0284C7] disabled:opacity-50 transition-all">
                        {formSubmitting ? 'Submitting…' : 'Submit Review'}
                      </button>
                    </div>
                  </form>
                </SectionCard>
              )}
            </div>
          )}
          {!user && (
            <p className="text-sm text-[#6B7280] mb-6">
              <Link href="/auth/login" className="font-semibold text-[#0EA5E9] hover:text-[#0284C7]">Sign in</Link> to write a review.
            </p>
          )}

          {/* Sort Tabs */}
          <div className="flex items-center gap-2 flex-wrap mb-5">
            <span className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">Sort:</span>
            {(['recent', 'helpful', 'highest', 'lowest'] as const).map(s => (
              <button key={s} onClick={() => { setReviewSort(s); setReviewPage(1); }} className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${reviewSort === s ? 'bg-[#0EA5E9] text-white' : 'bg-white border border-[#E5E7EB] text-[#374151] hover:border-[#9CA3AF]'}`}>
                {s === 'recent' ? 'Most Recent' : s === 'helpful' ? 'Most Helpful' : s === 'highest' ? 'Highest Rated' : 'Lowest Rated'}
              </button>
            ))}
          </div>

          {/* Review List */}
          {reviewsLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <SectionCard key={i}>
                  <div className="p-5 animate-pulse">
                    <div className="flex gap-3 mb-3">
                      <SkeletonPulse className="w-10 h-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <SkeletonPulse className="h-3 w-1/4" />
                        <SkeletonPulse className="h-2.5 w-1/5" />
                      </div>
                    </div>
                    <SkeletonPulse className="h-3 w-3/4 mb-1.5" />
                    <SkeletonPulse className="h-3 w-full" />
                  </div>
                </SectionCard>
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <SectionCard>
              <div className="p-10 text-center">
                <svg className="w-12 h-12 text-[#E5E7EB] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                <p className="text-sm font-medium text-[#374151]">No reviews yet</p>
                <p className="text-xs text-[#9CA3AF] mt-1">Be the first to leave a review!</p>
              </div>
            </SectionCard>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <SectionCard key={review.id}>
                  <div className="p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <UserAvatar user={asUser(review.user)} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-[#111827]">{review.user.name}</span>
                          <span className="text-[10px] text-[#9CA3AF]">{new Date(review.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
                        <StarRating rating={review.rating} size="xs" />
                      </div>
                    </div>
                    {review.title && <h4 className="font-semibold text-sm text-[#111827] mb-1.5">{review.title}</h4>}
                    <p className="text-sm text-[#4B5563] leading-relaxed">{review.content}</p>
                    <div className="mt-3 pt-3 border-t border-[#F9FAFB]">
                      <button onClick={() => handleHelpful(review.id)} disabled={!user || helpfulLoading === review.id} className="inline-flex items-center gap-1.5 text-xs text-[#9CA3AF] hover:text-[#0EA5E9] disabled:opacity-50 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
                        Helpful ({review.helpfulCount})
                      </button>
                    </div>
                  </div>
                </SectionCard>
              ))}

              {reviewTotalPages > 1 && (
                <div className="flex justify-center items-center gap-2 pt-4">
                  <button onClick={() => setReviewPage(p => Math.max(1, p - 1))} disabled={reviewPage === 1} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40 transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    Previous
                  </button>
                  <span className="text-xs text-[#6B7280] px-2">Page {reviewPage} of {reviewTotalPages}</span>
                  <button onClick={() => setReviewPage(p => Math.min(reviewTotalPages, p + 1))} disabled={reviewPage === reviewTotalPages} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40 transition-all">
                    Next
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── You May Also Like ─── */}
        {(relatedLoading || relatedListings.length > 0) && (
          <div className="mt-12 pt-8 border-t border-[#E5E7EB]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-xl font-bold text-[#111827]">You May Also Like</h2>
                <p className="text-sm text-[#6B7280] mt-0.5">More from <span className="font-medium text-[#374151]">{listing.category.name}</span></p>
              </div>
              <Link href={`/listings?category=${listing.category.slug}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0EA5E9] hover:text-[#0284C7] border border-[#E5E7EB] hover:border-[#0EA5E9] px-3.5 py-2 rounded-xl transition-all">
                Browse all
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>

            <div className="flex items-center gap-2 mb-5">
              <span className="inline-flex items-center gap-1.5 bg-[#EFF6FF] text-[#0369A1] text-xs font-semibold px-3 py-1.5 rounded-full border border-[#BFDBFE]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                {listing.category.name}
              </span>
              <span className="text-xs text-[#9CA3AF]">Similar items in this collection</span>
            </div>

            {relatedLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden animate-pulse">
                    <div className="aspect-[4/3] bg-[#F3F4F6]" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 bg-[#F3F4F6] rounded-full" />
                      <div className="h-3 bg-[#F3F4F6] rounded-full w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {relatedListings.map(rel => <ListingCard key={rel.id} listing={rel} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Lightbox / Fullscreen ─── */}
      {zoomOpen && images.length > 0 && (() => {
        let touchStartX = 0;
        const onTouchStart = (e: React.TouchEvent) => { touchStartX = e.touches[0].clientX; };
        const onTouchEnd = (e: React.TouchEvent) => {
          const delta = touchStartX - e.changedTouches[0].clientX;
          if (Math.abs(delta) > 40) {
            if (delta > 0) { nextImage(); } else { prevImage(); }
          }
        };
        return (
          <div
            className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center"
            onClick={() => setZoomOpen(false)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <button
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition-colors z-10"
              aria-label="Close fullscreen"
              onClick={() => setZoomOpen(false)}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            {images.length > 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/40 text-white text-xs font-semibold px-3 py-1 rounded-full z-10">
                {activeImage + 1} / {images.length}
              </div>
            )}

            <div
              className="relative flex items-center justify-center w-full max-w-5xl px-16 py-10"
              style={{ maxHeight: '90vh' }}
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={images[activeImage]}
                alt={listing.title}
                width={1200}
                height={800}
                className="object-contain w-full h-auto max-h-[80vh]"
                unoptimized
                draggable={false}
              />
            </div>

            {images.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); prevImage(); }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-colors shadow-lg"
                  aria-label="Previous image"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); nextImage(); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/30 text-white flex items-center justify-center transition-colors shadow-lg"
                  aria-label="Next image"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                </button>

                <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      onClick={(e) => { e.stopPropagation(); setActiveImage(i); }}
                      className={`h-1.5 rounded-full transition-all ${i === activeImage ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'}`}
                      aria-label={`Go to image ${i + 1}`}
                    />
                  ))}
                </div>

                <p className="absolute bottom-5 right-5 text-white/30 text-[10px] hidden sm:block">← → keys to navigate</p>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}