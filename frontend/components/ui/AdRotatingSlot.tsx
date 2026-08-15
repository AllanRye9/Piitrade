'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useSiteConfig } from '@/context/SiteConfigContext';
import { resolveImageUrl } from '@/lib/utils';

/**
 * AdRotatingSlot
 *
 * Occupies the exact footprint of the old "PIITRADE EXCHANGE · Money
 * Transfer Rates" widget — rendered by SiteAnalytics.tsx in place of that
 * widget's header bar + rate rows, while SiteAnalytics's stat cards column
 * beside it is untouched. Same outer classes/height as the widget it
 * replaced (`flex-1 min-w-0 bg-white rounded-xl border border-gray-200
 * shadow-sm overflow-hidden`, ~116px tall — matching the old header row
 * (~28px) + rate-rows body (minHeight 88px) combined) so the surrounding
 * layout doesn't shift.
 *
 * Cross-fades through however many images the admin has uploaded in
 * /admin/settings → Homepage Advertisement, each shown for
 * SiteConfig.adIntervalSeconds (default 5s) before advancing. A slow
 * diagonal sheen sweep plays continuously to catch the eye, the same way
 * the old widget's "FIND" button pulsed.
 *
 * Optionally overlays a fixed brand watermark (configured in /admin/settings
 * → Ad Slot Watermark — a repurposed version of the old "Exchange Logo"
 * control, which used to sit beside the retired currency-rate text). The
 * watermark stays in place across every rotating image; its own link (if
 * set) is independent of whatever link the currently-showing ad image has.
 *
 * Renders nothing when no ad images are configured, so SiteAnalytics simply
 * collapses back to a stat-cards-only layout.
 */
function WatermarkLink({
  href, className, style, children,
}: {
  href?: string | null; className: string; style: React.CSSProperties; children: React.ReactNode;
}) {
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </a>
    );
  }
  return <div className={className} style={style}>{children}</div>;
}

export default function AdRotatingSlot() {
  const { adImages, adIntervalSeconds, logoUrl, logoPages, logoAltText, logoSize, logoLinkUrl, logoDisplayMode } = useSiteConfig();
  const [index, setIndex] = useState(0);

  const intervalMs = Math.max(1, adIntervalSeconds || 5) * 1000;
  const count = adImages?.length || 0;
  const watermarkUrl = logoPages?.includes('ad-slot') ? logoUrl : null;

  // Rotate to the next image on the admin-configured timer.
  useEffect(() => {
    if (count < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [count, intervalMs]);

  // If the admin removes images while this is mounted, clamp back to a valid index.
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  if (count === 0) return null;

  const current = adImages[Math.min(index, count - 1)];

  const stack = (
    <div className="relative w-full h-full overflow-hidden">
      {adImages.map((ad, i) => (
        <div
          key={ad.id}
          className={`absolute inset-0 transition-all duration-700 ease-out ${
            i === index ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
          }`}
          aria-hidden={i !== index}
        >
          <Image
            src={resolveImageUrl(ad.imageUrl)}
            alt={ad.altText || 'Advertisement'}
            fill
            className="object-cover"
            sizes="400px"
            priority={i === 0}
          />
        </div>
      ))}
      {/* Continuous diagonal sheen sweep — attention-grabbing, matches the
          pulsing style of the old widget's FIND button. */}
      <div className="ad-sheen pointer-events-none absolute inset-0" />
    </div>
  );

  return (
    <div
      className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden relative"
      style={{ height: '116px' }}
    >
      {current.linkUrl ? (
        <a
          href={current.linkUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          aria-label={current.altText || 'Advertisement'}
          className="block w-full h-full"
        >
          {stack}
        </a>
      ) : (
        stack
      )}

      {/* "Ad" badge — same corner-label convention as the widget it replaced */}
      <span className="absolute top-1 left-1.5 z-10 text-[6px] font-black tracking-widest uppercase text-white/90 bg-black/30 rounded px-1 py-px backdrop-blur-sm pointer-events-none">
        Ad
      </span>

      {/* Watermark — configured in /admin/settings → Ad Slot Watermark */}
      {watermarkUrl && logoDisplayMode === 'replace' ? (
        // "Prominent Overlay" mode — a translucent banner strip across the
        // bottom of the slot, tall enough to comfortably fit the logo.
        <WatermarkLink
          href={logoLinkUrl}
          className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center bg-black/35 backdrop-blur-[1px] px-2"
          style={{ height: '26px' }}
        >
          <div className="relative h-full" style={{ width: logoSize * 3 }}>
            <Image
              src={resolveImageUrl(watermarkUrl)}
              alt={logoAltText || 'Watermark'}
              fill
              className="object-contain"
              sizes={`${logoSize * 3}px`}
            />
          </div>
        </WatermarkLink>
      ) : watermarkUrl ? (
        // "Small Watermark" mode — a corner badge opposite the "Ad" tag.
        <WatermarkLink
          href={logoLinkUrl}
          className="absolute top-1 right-1.5 z-10 rounded bg-white/85 backdrop-blur-[1px] shadow-sm p-0.5"
          style={{ width: logoSize, height: logoSize }}
        >
          <div className="relative w-full h-full">
            <Image
              src={resolveImageUrl(watermarkUrl)}
              alt={logoAltText || 'Watermark'}
              fill
              className="object-contain rounded"
              sizes={`${logoSize}px`}
            />
          </div>
        </WatermarkLink>
      ) : null}

      {/* Rotation dots — only shown when there's more than one image to cycle
          through. Sits above the watermark banner strip when one is present,
          so the two never overlap. */}
      {count > 1 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 z-10"
          style={{ bottom: watermarkUrl && logoDisplayMode === 'replace' ? '30px' : '6px' }}
        >
          {adImages.map((ad, i) => (
            <span
              key={ad.id}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === index ? 'w-3 bg-white shadow' : 'w-1 bg-white/60'
              }`}
            />
          ))}
        </div>
      )}

      <style jsx>{`
        .ad-sheen::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(115deg, transparent 40%, rgba(255, 255, 255, 0.35) 50%, transparent 60%);
          transform: translateX(-120%);
          animation: adSheenSweep 4.5s ease-in-out infinite;
        }
        @keyframes adSheenSweep {
          0%, 40% { transform: translateX(-120%); }
          60%, 100% { transform: translateX(120%); }
        }
      `}</style>
    </div>
  );
}
