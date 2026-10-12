'use client';

import { useEffect, useState } from 'react';

/** Compact "ends in 2d 04:12:09" pill. Renders nothing without a future endAt. */
export default function OfferCountdown({ endAt, className = '' }: { endAt?: string | null; className?: string }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!endAt) { setLeft(null); return; }
    const end = new Date(endAt).getTime();
    if (!Number.isFinite(end)) { setLeft(null); return; }
    const tick = () => setLeft(Math.max(0, end - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endAt]);

  if (left === null || left <= 0) return null;
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold tabular-nums text-white ${className}`}
      aria-label="Time remaining">
      <span aria-hidden="true">⏱</span>
      {d > 0 && <span>{d}d</span>}
      <span>{pad(h)}:{pad(m)}:{pad(s)}</span>
    </span>
  );
}
