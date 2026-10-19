'use client';

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(n);
}

/**
 * Item counter pill. Re-plays a small "pop" whenever the number changes and shows a pulsing
 * dot when something new landed in the last 24 h. Renders nothing for 0/unknown.
 */
export function CountBadge({
  count,
  fresh = 0,
  tone = 'dark',
  className = '',
}: {
  count: number | undefined | null;
  fresh?: number;
  /** dark: on the dark nav bar · light: on white surfaces */
  tone?: 'dark' | 'light';
  className?: string;
}) {
  if (!count) return null;
  const palette = tone === 'dark' ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-600';
  return (
    <span
      key={count}
      className={`relative inline-flex min-w-[1.1rem] animate-pop items-center justify-center rounded-full px-1 text-[9px] font-bold leading-[1.1rem] tabular-nums ${palette} ${className}`}
      title={fresh > 0 ? `${count.toLocaleString('en-US')} items · ${fresh} new today` : `${count.toLocaleString('en-US')} items`}
    >
      {formatCount(count)}
      {fresh > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-1.5 w-1.5" aria-label={`${fresh} new today`}>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
      )}
    </span>
  );
}
