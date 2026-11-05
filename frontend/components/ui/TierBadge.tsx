import type { CSSProperties } from 'react';

/**
 * Gold and Platinum visibility badges, one shared design everywhere (listing cards, merchant rows,
 * package pickers, the post-an-ad tier picker).
 *
 *   GOLD      a gold medal (coin + star) on a polished gold metal pill
 *   PLATINUM  a cut diamond on a cool, brushed platinum / silver pill
 *
 * Icons are inline SVG with flat fills (no gradient ids to collide when a page holds many badges), so
 * they look identical on every device, unlike the 🥇 / 💎 emoji they replace, which change with the OS.
 */
export type PaidTier = 'GOLD' | 'PLATINUM';

const SIZES = {
  xs: { box: 'gap-0.5 py-px pl-0.5 pr-1.5 text-[8px] xs:text-[9px]', icon: 10 },
  sm: { box: 'gap-1 py-0.5 pl-1 pr-2 text-[9px] xs:text-[10px]', icon: 13 },
  md: { box: 'gap-1.5 py-1 pl-1.5 pr-2.5 text-xs', icon: 18 },
} as const;

const STYLES: Record<PaidTier, { style: CSSProperties; label: string }> = {
  GOLD: {
    label: 'Gold',
    style: {
      background: 'linear-gradient(135deg,#fff1a8 0%,#f7cf4a 30%,#d99a14 62%,#f6d675 84%,#b8780a 100%)',
      color: '#4a2d00',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.75), 0 1px 2px rgba(120,80,0,.35)',
      border: '1px solid rgba(160,105,0,.55)',
    },
  },
  PLATINUM: {
    label: 'Platinum',
    style: {
      background: 'linear-gradient(135deg,#ffffff 0%,#e4eaf2 28%,#aeb9c8 60%,#f3f6fa 84%,#8d9aab 100%)',
      color: '#1b2638',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(40,55,80,.35)',
      border: '1px solid rgba(110,125,145,.65)',
    },
  },
};

/** Gold medal: rim, face and a five-point star. */
function MedalIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="#8a5600" />
      <circle cx="12" cy="12" r="9.2" fill="#ffd84d" />
      <circle cx="12" cy="12" r="7.2" fill="none" stroke="#c98a0b" strokeWidth="1" />
      <path d="M12 5.6l1.9 4 4.4.5-3.3 3 .9 4.3L12 15.2l-3.9 2.2.9-4.3-3.3-3 4.4-.5z" fill="#b86f00" />
      <path d="M12 5.6l1.9 4-1.9.2z" fill="#ffe98a" opacity=".9" />
    </svg>
  );
}

/** Cut diamond: table, crown and pavilion facets in graded blues. */
function DiamondIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M6 3h12l4.5 6L12 22 1.5 9z" fill="#5b86c2" />
      <path d="M6 3h12l-3 6H9z" fill="#ffffff" />
      <path d="M6 3L9 9 1.5 9z" fill="#cfe2fb" />
      <path d="M18 3l-3 6 7.5 0z" fill="#aac8f2" />
      <path d="M1.5 9H9l3 13z" fill="#7da5de" />
      <path d="M22.5 9H15l-3 13z" fill="#4a74b3" />
      <path d="M9 9h6l-3 13z" fill="#8fb6ea" />
      <path d="M6 3h12l4.5 6L12 22 1.5 9z" fill="none" stroke="#2f4f80" strokeWidth=".9" strokeLinejoin="round" />
    </svg>
  );
}

/** Just the icon (for tight spaces such as a picker tile). */
export function TierIcon({ tier, size = 18 }: { tier: PaidTier; size?: number }) {
  return tier === 'PLATINUM' ? <DiamondIcon size={size} /> : <MedalIcon size={size} />;
}

export default function TierBadge({
  tier,
  size = 'sm',
  className = '',
  title,
}: {
  tier: PaidTier;
  size?: keyof typeof SIZES;
  className?: string;
  title?: string;
}) {
  const s = SIZES[size];
  const t = STYLES[tier];
  return (
    <span
      className={`inline-flex w-fit select-none items-center rounded-full font-extrabold uppercase tracking-wider ${s.box} ${className}`}
      style={t.style}
      title={title ?? `${t.label} listing`}
    >
      <TierIcon tier={tier} size={s.icon} />
      {t.label}
    </span>
  );
}
