'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { resolveImageUrl } from '@/lib/utils';

interface Banner {
  id: string;
  section?: string;
  cdnUrl: string;
  title?: string;
  altText?: string;
  linkUrl?: string;
  dimensions: string;
  sortOrder: number;
}

interface Props {
  className?: string;
}

/**
 * StickyHeaderBanner  (admin name: "Promo Header Banner", media section `sticky-header`)
 *
 * Promotional banner (935 × 45 px) shown ONCE at the very top of the page. It is a banner only:
 * it never renders the Site Logo, and the Site Logo never renders here (see BrandLogo / section
 * `brand-logo`). Despite the legacy file name it is not pinned: it scrolls away with the page and the
 * navigation header below it is the sticky element.
 *
 * The banner keeps its 935 : 45 proportion and shrinks with the screen, so it is never stretched or
 * cropped on phones. The outer strip stretches edge-to-edge in the banner's own edge colour so there is
 * no visible dead-zone on wide screens.
 *
 * Supports images AND animated GIFs — rendered as a plain <img> so GIF animation is preserved
 * (Next/Image re-encodes GIFs as static WebP).
 */
export default function StickyHeaderBanner({ className = '' }: Props) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  // Banner ids whose image actually 404'd at runtime (e.g. uploaded to the
  // backend's local-disk fallback and lost on redeploy) — filtered out below
  // so a dead banner never renders as a broken image in this full-width strip.
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  // Memoized so the array reference is stable across re-renders that don't
  // actually change its contents — the pixel-sampling effect below depends
  // on it, and an unstable reference would re-trigger that effect (and its
  // own setState) on every render, looping forever.
  const visibleBanners = useMemo(
    () => banners.filter((b) => !failedIds.has(b.id)),
    [banners, failedIds]
  );
  // Background colour sampled from first pixel of banner (fallback: slate-900)
  const [bgColor, setBgColor] = useState('#0f172a');

  useEffect(() => {
    const fetchBanners = async () => {
      try {
        setIsLoading(true);
        const { data } = await api.get('/site-media?section=sticky-header');
        if (data) {
          const items: Banner[] = (data.media || data.banners || [])
            .filter((item: Banner) => item.section !== 'brand-logo');
          if (items.length > 0) setBanners(items);
        }
      } catch {
        // silently fall back — no banners shown
      } finally {
        setIsLoading(false);
      }
    };
    fetchBanners();
  }, []);

  /* Auto-rotate every 8 s when multiple banners exist */
  useEffect(() => {
    if (visibleBanners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % visibleBanners.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [visibleBanners.length]);

  /* Sample the edge pixel of the current banner to fill the outer strip */
  useEffect(() => {
    const current = visibleBanners[currentIndex % (visibleBanners.length || 1)];
    if (!current) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        setBgColor(`rgb(${r},${g},${b})`);
      } catch {
        setBgColor('#0f172a');
      }
    };
    img.onerror = () => setBgColor('#0f172a');
    img.src = resolveImageUrl(current.cdnUrl);
  }, [visibleBanners, currentIndex]);

  if (isLoading || visibleBanners.length === 0) return null;

  const current = visibleBanners[currentIndex % visibleBanners.length];
  if (!current) return null;

  const markFailed = (id: string) => setFailedIds((prev) => new Set(prev).add(id));

  const src = resolveImageUrl(current.cdnUrl);
  const alt = current.altText || current.title || 'Promotional banner';

  /* Full-width strip + a centred slot that keeps the 935 × 45 proportion at every screen width */
  const bannerSlot = (
    <div
      className="relative w-full flex justify-center items-center overflow-hidden"
      style={{ backgroundColor: bgColor, transition: 'background-color 0.4s ease' }}
    >
      <div className="relative shrink-0" style={{ width: '100%', maxWidth: '935px', aspectRatio: '935 / 45' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          width={935}
          height={45}
          style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
          loading="eager"
          onError={() => markFailed(current.id)}
        />
      </div>

      {/* Dot indicators when multiple banners */}
      {visibleBanners.length > 1 && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10 flex gap-1">
          {visibleBanners.map((_, idx) => (
            <button
              key={idx}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCurrentIndex(idx); }}
              className={`h-1.5 rounded-full transition-all ${
                idx === currentIndex ? 'bg-white w-4' : 'bg-white/50 hover:bg-white/75 w-1.5'
              }`}
              aria-label={`Go to banner ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );

  if (current.linkUrl) {
    return (
      <Link
        href={current.linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`block w-full ${className}`}
      >
        {bannerSlot}
      </Link>
    );
  }

  return <div className={`w-full ${className}`}>{bannerSlot}</div>;
}
