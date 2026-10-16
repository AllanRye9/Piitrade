'use client';

import { useEffect, useState } from 'react';
import { fetchKycImageObjectUrl } from '@/lib/kycImage';

/** Loads a private KYC image through the authenticated endpoint; click opens it full-size. */
export function KycImage({ url, alt, className, caption }: { url: string; alt: string; className?: string; caption?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    fetchKycImageObjectUrl(url)
      .then((u) => { if (cancelled) URL.revokeObjectURL(u); else { objectUrl = u; setSrc(u); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);

  if (failed) return <p className="text-xs text-red-500">Could not load image.</p>;
  if (!src) return <div className={`${className ?? ''} animate-pulse bg-gray-100`} style={{ minWidth: 96 }} aria-label="Loading image" />;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={className} />
      {caption && <p className="text-[10px] text-center text-gray-400 mt-1">{caption}</p>}
    </a>
  );
}
