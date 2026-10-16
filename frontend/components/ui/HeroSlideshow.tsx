'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import Image from 'next/image';
import { resolveImageUrl } from '@/lib/utils';
import Link from 'next/link';
import { useTr } from '@/lib/i18n/useTr';

interface Slide {
  image: string;
  alt: string;
}

// No default external slides — hero images are uploaded by the admin via the media manager.
const EMPTY_SLIDES: Slide[] = [];

interface HeroSlideshowProps {
  /** Slides passed in from a parent (e.g. server component via API data). */
  slides?: Slide[];
  interval?: number;
  /** When true, fetches admin-uploaded hero images from /api/site-media?section=hero */
  fetchFromApi?: boolean;
}

export default function HeroSlideshow({
  slides: propSlides,
  interval = 5000,
  fetchFromApi = true,
}: HeroSlideshowProps) {
  const tr = useTr();
  const [slides, setSlides] = useState<Slide[]>(propSlides ?? EMPTY_SLIDES);
  // True once we know whether the admin has uploaded hero images, so the welcome
  // panel below only appears when there really are none (no flash while loading).
  const [heroChecked, setHeroChecked] = useState<boolean>(!fetchFromApi);
  const [current, setCurrent] = useState(0);
  // Track the previously active slide so it stays visible under the incoming slide.
  // This prevents any blackout between transitions.
  const [prev, setPrev] = useState<number>(-1);
  const [failedImages, setFailedImages] = useState<Set<number>>(new Set());
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const isPausedRef = useRef(false);

  // Fetch admin-uploaded hero images.
  useEffect(() => {
    if (!fetchFromApi) return;

    api.get('/site-media', { params: { section: 'hero' } })
      .then(({ data }) => data)
      .then((payload) => {
        const media = payload?.media ?? [];
        if (!Array.isArray(media) || media.length === 0) return;

        const apiSlides: Slide[] = media.map((m: { cdnUrl: string; altText?: string }) => ({
          image: resolveImageUrl(m.cdnUrl),
          alt: m.altText || 'Hero image',
        }));

        setSlides([...apiSlides, ...(propSlides ?? EMPTY_SLIDES)]);
      })
      .catch(() => { /* silently use gradient placeholder */ })
      .finally(() => setHeroChecked(true));
  }, [fetchFromApi, propSlides]);

  // Pause auto-advance when the browser tab is hidden to avoid visual artefacts.
  useEffect(() => {
    const handleVisibility = () => {
      isPausedRef.current = document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const advance = useCallback(() => {
    if (isPausedRef.current) return;
    setCurrent((c) => {
      if (slides.length <= 1) return c;
      const loadedCandidates = Array.from(loadedImages).filter((idx) => !failedImages.has(idx));
      if (loadedCandidates.length > 0) {
        let next = c;
        for (let i = 0; i < slides.length; i += 1) {
          next = (next + 1) % slides.length;
          if (loadedCandidates.includes(next)) {
            setPrev(c);
            return next;
          }
        }
      }
      setPrev(c);
      return (c + 1) % slides.length;
    });
  }, [failedImages, loadedImages, slides.length]);

  const goBack = useCallback(() => {
    setCurrent((c) => {
      if (slides.length <= 1) return c;
      const loadedCandidates = Array.from(loadedImages).filter((idx) => !failedImages.has(idx));
      if (loadedCandidates.length > 0) {
        let next = c;
        for (let i = 0; i < slides.length; i += 1) {
          next = (next - 1 + slides.length) % slides.length;
          if (loadedCandidates.includes(next)) {
            setPrev(c);
            return next;
          }
        }
      }
      setPrev(c);
      return (c - 1 + slides.length) % slides.length;
    });
  }, [failedImages, loadedImages, slides.length]);

  const goTo = useCallback((index: number) => {
    if (failedImages.has(index)) return;
    if (!loadedImages.has(index)) return;
    setCurrent((c) => {
      setPrev(c);
      return index;
    });
  }, [failedImages, loadedImages]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(advance, interval);
    return () => clearInterval(timer);
  }, [advance, interval, slides.length]);

  const handleImageError = (index: number) => {
    // The slideshow already falls back to a placeholder UI below, so this is
    // purely diagnostic — but the default Next/browser 404 log for these
    // gives no indication of *what* failed or *why*, which makes it easy to
    // mistake for an app-code bug. Log a labelled message pointing at the
    // real cause: the DB `SiteMedia` row for this hero slide still points at
    // a file (see `image`) that no longer exists in backend storage
    // (deleted from disk/S3, or wiped on a redeploy without a persistent
    // volume). Fix: re-upload the image in Admin > Media, or delete the
    // stale SiteMedia row.
    const slide = slides[index];
    console.error(
      `[HeroSlideshow] Slide ${index + 1}/${slides.length} failed to load — `
        + `origin: admin-uploaded hero image (SiteMedia, section="hero"), `
        + `not a code bug. The backend storage file referenced by this slide `
        + `is missing (404), likely deleted or lost on redeploy.\n`
        + `  alt: "${slide?.alt ?? ''}"\n`
        + `  url: ${slide?.image ?? '(unknown)'}\n`
        + `Fix: re-upload the image in Admin > Media, or remove the stale entry.`
    );
    setFailedImages((prev) => new Set(prev).add(index));
  };

  const handleImageLoad = (index: number) => {
    setLoadedImages((prev) => new Set(prev).add(index));
  };

  useEffect(() => {
    if (slides.length === 0) return;
    setLoadedImages((prev) => {
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx < slides.length) next.add(idx);
      });
      return next;
    });
    setFailedImages((prev) => {
      const next = new Set<number>();
      prev.forEach((idx) => {
        if (idx < slides.length) next.add(idx);
      });
      return next;
    });
  }, [slides.length]);

  // No slides: until the hero request settles show a quiet brand-coloured panel
  // (so nothing flashes); afterwards a proper welcome with clear actions.
  if (slides.length === 0) {
    return (
      <div
        className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#E94B00] via-[#F55906] to-[#FF6500]"
        role="region"
        aria-label={tr('Welcome banner')}
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-white/10" aria-hidden="true" />
        {heroChecked && (
          <div className="relative flex h-full flex-col items-center justify-center px-6 py-8 text-center text-white animate-fade-in">
            <h1 className="max-w-xl text-balance text-2xl font-extrabold leading-tight tracking-tight drop-shadow-sm sm:text-3xl lg:text-4xl">
              {tr('Buy, sell and find anything in Uganda')}
            </h1>
            <p className="mt-2 max-w-md text-balance text-sm text-white/90 sm:text-base">
              {tr('Cars, property, jobs, electronics and more, from sellers near you.')}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/listings"
                className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-[#E94B00] shadow-md transition-all hover:bg-orange-50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#F55906]"
              >
                {tr('Browse listings')}
              </Link>
              <Link
                href="/listings/create"
                className="rounded-full border-2 border-white/80 px-6 py-2 text-sm font-bold text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#F55906]"
              >
                {tr('Post a free ad')}
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
      <div
        className="absolute inset-0 overflow-hidden bg-[var(--premium-cream,#FAF8F5)]"
        style={{ isolation: 'isolate' }}
        role="region"
        aria-label="Image slideshow"
    >
      {slides.map((slide, i) => {
        const isActive = i === current;
        const isPrev = i === prev;
        // Active slide sits on top (z-index 2) and is fully opaque.
        // Previous slide sits just beneath (z-index 1) and stays fully opaque so
        // there is never a transparent gap while the new slide fades in.
        // All other slides are hidden (z-index 0, opacity 0).
        const zIndex = isActive ? 2 : isPrev ? 1 : 0;
        const opacity = isActive ? 1 : isPrev ? 1 : 0;

        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              zIndex,
              opacity,
              // Only animate opacity when a slide becomes active so there is a
              // smooth fade-in.  Non-active slides change instantly.
              transition: isActive ? 'opacity 700ms ease-in-out' : undefined,
              willChange: 'opacity',
              // Force GPU compositing to prevent repaints from neighbouring
              // elements (e.g. the category side-nav) bleeding into the slideshow.
              transform: 'translateZ(0)',
            }}
            aria-hidden={!isActive}
          >
            {failedImages.has(i) ? (
              <div className="absolute inset-0 bg-[var(--premium-cream,#FAF8F5)] flex flex-col items-center justify-center gap-2">
                <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <p className="text-gray-400 text-xs">Slide image unavailable</p>
              </div>
            ) : (
              <Image
                src={resolveImageUrl(slide.image)}
                alt={slide.alt}
                fill
                className="object-cover"
                priority={i === 0}
                sizes="86vw"
                quality={92}
                onError={() => handleImageError(i)}
                onLoadingComplete={() => handleImageLoad(i)}
              />
            )}
          </div>
        );
      })}

      {/* Subtle overlay for text legibility without dimming images */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0B132B]/15 via-transparent to-[#0B132B]/20 pointer-events-none" style={{ zIndex: 3 }} />

      {/* Navigation arrows */}
      <button
        onClick={goBack}
        className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/30 hover:bg-[#F55906]/80 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
        aria-label="Previous slide"
        style={{ zIndex: 4 }}
      >
        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        onClick={advance}
        className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/30 hover:bg-[#F55906]/80 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
        aria-label="Next slide"
        style={{ zIndex: 4 }}
      >
        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Slide indicators */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5" style={{ zIndex: 4 }}>
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Go to slide ${i + 1}`}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current
                ? 'w-6 bg-[#F55906]'
                : 'w-1.5 bg-white/30 hover:bg-white/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
