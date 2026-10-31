'use client';

import { useEffect, useState } from 'react';
import { fetchBrandLogo } from '@/components/ui/BrandLogo';
import { resolveImageUrl } from '@/lib/utils';

/**
 * Site logo that rotates while something is loading. Uses the admin-uploaded logo when there is one,
 * otherwise the built-in icon. `prefers-reduced-motion` users get a gentle pulse instead of a spin.
 */
export function LogoSpinner({ size = 40, label, className = '' }: { size?: number; label?: string; className?: string }) {
  const [src, setSrc] = useState<string>('/icon.svg');
  useEffect(() => {
    let alive = true;
    fetchBrandLogo().then((u) => { if (alive && u) setSrc(resolveImageUrl(u)); }).catch(() => { /* keep fallback */ });
    return () => { alive = false; };
  }, []);
  return (
    <span role="status" aria-live="polite" className={`inline-flex flex-col items-center gap-1.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        onError={() => setSrc('/icon.svg')}
        style={{ width: size, height: size }}
        className="logo-spin object-contain"
      />
      <span className={label ? 'text-xs font-medium text-gray-600' : 'sr-only'}>{label || 'Loading…'}</span>
    </span>
  );
}

/** Full-area overlay variant (position it inside a `relative` parent). */
export function LogoLoadingOverlay({ label, size = 56 }: { label?: string; size?: number }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-white/80 backdrop-blur-[1px]">
      <LogoSpinner size={size} label={label} />
    </div>
  );
}

/** Blocking full-screen loader for multi-second steps (photo check, posting, document upload). */
export function LogoFullScreen({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/75 backdrop-blur-sm" aria-busy="true">
      <div className="rounded-2xl bg-white px-8 py-6 shadow-2xl ring-1 ring-black/5">
        <LogoSpinner size={64} label={label} />
      </div>
    </div>
  );
}
