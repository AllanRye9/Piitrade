'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders `value` as a QR image (generated in the browser; nothing is sent anywhere). */
export function DeliveryQr({ value, size = 176 }: { value: string; size?: number }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: size })
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setSrc(''); });
    return () => { cancelled = true; };
  }, [value, size]);

  if (!src) return <div style={{ width: size, height: size }} className="mx-auto rounded-lg bg-white/60 animate-pulse" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="QR code for your delivery code" className="mx-auto rounded-lg bg-white p-1" />;
}
