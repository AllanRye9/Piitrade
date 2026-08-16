/**
 * CountryTheme.tsx
 *
 * Exports per-country design tokens (colours, motifs, hero text) and a
 * <CountryPageWrapper> component that wraps any page content in a
 * country-specific decorative skin when a country is selected.
 */
'use client';

import React from 'react';
import { Country } from '@/lib/types';
import { FlagIcon } from '@/components/ui/FlagIcon'; // SVG flags — no emoji

// ── Per-country design tokens ─────────────────────────────────────────────────

export interface CountryThemeConfig {
  country:        Country;
  /** ISO two-letter code for flag emoji fallback */
  flag:           string;
  /** ISO 3166-1 alpha-2 code used for SVG FlagIcon */
  isoCode:        string;
  name:           string;
  /** Tailwind gradient class for the hero accent bar */
  gradientFrom:   string;
  gradientVia:    string;
  gradientTo:     string;
  /** Solid accent colour (hex) used for borders and highlights */
  accent:         string;
  /** Light tinted background (hex) */
  bgTint:         string;
  /** Hero tagline shown on the country page */
  tagline:        string;
  /** Brief description of the market */
  description:    string;
  /** Decorative SVG motif element rendered in the header */
  Motif:          React.FC<{ className?: string }>;
  /** CSS for the decorative banner pattern */
  bannerClass:    string;
}

// ── UAE ───────────────────────────────────────────────────────────────────────

const UAEMotif: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 200 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Stylised Arabic arch / Burj Khalifa silhouette */}
    <rect x="90" y="5" width="20" height="70" fill="#C8A951" opacity="0.6" rx="2" />
    <rect x="80" y="20" width="40" height="55" fill="#C8A951" opacity="0.35" rx="2" />
    <rect x="70" y="35" width="60" height="40" fill="#C8A951" opacity="0.20" rx="3" />
    <ellipse cx="100" cy="10" rx="5" ry="7" fill="#C8A951" opacity="0.9" />
    {/* Decorative stars */}
    {[20, 170].map(x => (
      <polygon key={x} points={`${x},15 ${x+3},22 ${x+10},22 ${x+4},27 ${x+6},34 ${x},29 ${x-6},34 ${x-4},27 ${x-10},22 ${x-3},22`}
        fill="#C8A951" opacity="0.5" />
    ))}
  </svg>
);

// ── UGANDA ────────────────────────────────────────────────────────────────────

const UGANDAMotif: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 200 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Grey crowned crane — iconic Uganda bird */}
    <ellipse cx="100" cy="55" rx="22" ry="14" fill="#E8C547" opacity="0.55" />
    <ellipse cx="100" cy="42" rx="8" ry="10" fill="#E8C547" opacity="0.75" />
    <circle  cx="100" cy="33" r="6"           fill="#E8C547" opacity="0.85" />
    {/* Crown feathers */}
    {[-6,-3,0,3,6].map((dx, i) => (
      <line key={i} x1={100+dx} y1="27" x2={100+dx*1.5} y2="18" stroke="#E8C547" strokeWidth="1.5" opacity="0.7" />
    ))}
    {/* Wings */}
    <path d="M78 55 Q88 40 100 55" stroke="#9B59B6" strokeWidth="2" fill="none" opacity="0.5" />
    <path d="M122 55 Q112 40 100 55" stroke="#9B59B6" strokeWidth="2" fill="none" opacity="0.5" />
    {/* Horizontal stripes — Uganda flag colours */}
    {['#000','#F5A623','#DC143C'].map((c, i) => (
      <rect key={c} x="10" y={62+i*4} width="180" height="3" fill={c} opacity="0.25" rx="1" />
    ))}
  </svg>
);

// ── KENYA ─────────────────────────────────────────────────────────────────────

const KENYAMotif: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 200 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Maasai shield + spears */}
    <ellipse cx="100" cy="45" rx="18" ry="26" fill="#CE1126" opacity="0.6" />
    <ellipse cx="100" cy="45" rx="12" ry="20" fill="#000" opacity="0.4" />
    <line x1="100" y1="10" x2="100" y2="75" stroke="#006600" strokeWidth="3" opacity="0.7" />
    <line x1="88"  y1="12" x2="88"  y2="74" stroke="#006600" strokeWidth="2" opacity="0.5" />
    <line x1="112" y1="12" x2="112" y2="74" stroke="#006600" strokeWidth="2" opacity="0.5" />
    {/* Horizontal stripes */}
    {['#006600','#CE1126','#000'].map((c, i) => (
      <rect key={c} x="0" y={i*4} width="200" height="4" fill={c} opacity="0.18" />
    ))}
    {/* Savannah sun */}
    <circle cx="165" cy="18" r="10" fill="#F5A623" opacity="0.45" />
    {[0,45,90,135].map(a => (
      <line key={a} x1={165+12*Math.cos(a*Math.PI/180)} y1={18+12*Math.sin(a*Math.PI/180)}
            x2={165+18*Math.cos(a*Math.PI/180)} y2={18+18*Math.sin(a*Math.PI/180)}
            stroke="#F5A623" strokeWidth="1.5" opacity="0.4" />
    ))}
  </svg>
);

// ── CHINA ─────────────────────────────────────────────────────────────────────

const CHINAMotif: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 200 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Stylised Great-Wall battlements */}
    {[20,50,80,110,140,170].map(x => (
      <rect key={x} x={x} y="30" width="18" height="35" fill="#DE2910" opacity="0.3" rx="1" />
    ))}
    {[5,35,65,95,125,155,185].map(x => (
      <rect key={x} x={x} y="40" width="22" height="25" fill="#DE2910" opacity="0.18" rx="1" />
    ))}
    {/* Five stars — PRC flag */}
    {[
      { x: 30,  y: 18, r: 8  },
      { x: 52,  y: 10, r: 4.5 },
      { x: 62,  y: 18, r: 4.5 },
      { x: 58,  y: 28, r: 4.5 },
      { x: 46,  y: 32, r: 4.5 },
    ].map((s, i) => (
      <polygon key={i}
        points={Array.from({ length: 5 }, (_, k) => {
          const a = (k * 72 - 90) * Math.PI / 180;
          const b = (k * 72 - 90 + 36) * Math.PI / 180;
          return `${s.x+s.r*Math.cos(a)},${s.y+s.r*Math.sin(a)} ${s.x+s.r*0.4*Math.cos(b)},${s.y+s.r*0.4*Math.sin(b)}`;
        }).join(' ')}
        fill="#FFD700" opacity="0.75" />
    ))}
    {/* Decorative cloud / fortune motif */}
    <path d="M140 20 Q150 10 160 20 Q170 10 180 20 Q180 30 160 30 Q140 30 140 20Z" fill="#FFD700" opacity="0.3" />
  </svg>
);

// ── Theme registry ────────────────────────────────────────────────────────────

export const COUNTRY_THEMES: Record<Country, CountryThemeConfig> = {
  UAE: {
    country:      'UAE',
    flag:         '🇦🇪',
    isoCode:      'AE',
    name:         'United Arab Emirates',
    gradientFrom: 'from-green-700',
    gradientVia:  'via-white',
    gradientTo:   'to-red-700',
    accent:       '#C8A951',
    bgTint:       '#fffbf0',
    tagline:      'Premium Desert Market',
    description:  'Luxury goods, electronics and real estate from the heart of the Gulf.',
    Motif:        UAEMotif,
    bannerClass:  'bg-gradient-to-r from-green-800 via-white to-red-700',
  },
  UGANDA: {
    country:      'UGANDA',
    flag:         '🇺🇬',
    isoCode:      'UG',
    name:         'Uganda',
    gradientFrom: 'from-black',
    gradientVia:  'via-yellow-400',
    gradientTo:   'to-red-600',
    accent:       '#F5A623',
    bgTint:       '#fffcf0',
    tagline:      'Pearl of Africa Marketplace',
    description:  'Fresh produce, fashion, electronics and more from the Pearl of Africa.',
    Motif:        UGANDAMotif,
    bannerClass:  'bg-gradient-to-r from-black via-yellow-400 to-red-600',
  },
  KENYA: {
    country:      'KENYA',
    flag:         '🇰🇪',
    isoCode:      'KE',
    name:         'Kenya',
    gradientFrom: 'from-green-800',
    gradientVia:  'via-red-600',
    gradientTo:   'to-black',
    accent:       '#CE1126',
    bgTint:       '#fff8f8',
    tagline:      'Nairobi\'s Premier Marketplace',
    description:  'Technology, fashion, motors and real estate across the Kenyan highlands.',
    Motif:        KENYAMotif,
    bannerClass:  'bg-gradient-to-r from-green-800 via-red-700 to-black',
  },
  CHINA: {
    country:      'CHINA',
    flag:         '🇨🇳',
    isoCode:      'CN',
    name:         'China',
    gradientFrom: 'from-red-700',
    gradientVia:  'via-red-600',
    gradientTo:   'to-yellow-500',
    accent:       '#DE2910',
    bgTint:       '#fff5f5',
    tagline:      'Gateway to Chinese Markets',
    description:  'Electronics, fashion and collectibles direct from Chinese manufacturers.',
    Motif:        CHINAMotif,
    bannerClass:  'bg-gradient-to-r from-red-700 via-red-600 to-yellow-500',
  },
};

// ── CountryPageWrapper component ──────────────────────────────────────────────

interface WrapperProps {
  country:  Country;
  children: React.ReactNode;
  /** Extra class for the outer wrapper div */
  className?: string;
}

/**
 * CountryPageWrapper
 * Renders a decorative country-themed header strip above the page content.
 * Drop this around any page that should show country-specific branding.
 */
export function CountryPageWrapper({ country, children, className = '' }: WrapperProps) {
  const theme = COUNTRY_THEMES[country];

  return (
    <div className={`min-h-screen ${className}`} style={{ backgroundColor: theme.bgTint }}>

      {/* ── Decorative header banner ── */}
      <div className={`relative overflow-hidden ${theme.bannerClass} text-white`} style={{ minHeight: '90px' }}>
        {/* Subtle radial overlay for depth */}
        <div className="absolute inset-0 bg-black/20 pointer-events-none" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Country flag — SVG via FlagIcon, not emoji */}
            <div className="rounded-lg overflow-hidden shadow ring-2 ring-white/30 shrink-0">
              <FlagIcon code={theme.isoCode} size={52} />
            </div>
            <div className="min-w-0">
              <h1 className="font-black text-xl sm:text-2xl leading-tight drop-shadow-sm truncate">
                {theme.name}
              </h1>
              <p className="text-sm font-semibold text-white/85 truncate">{theme.tagline}</p>
              <p className="text-xs text-white/70 mt-0.5 hidden sm:block">{theme.description}</p>
            </div>
          </div>

          {/* Decorative SVG motif */}
          <theme.Motif className="w-48 h-16 shrink-0 hidden sm:block opacity-80" />
        </div>

        {/* Bottom accent stripe using flag colours */}
        <div className={`h-1 w-full ${theme.bannerClass} opacity-60`} />
      </div>

      {/* Page content */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        {children}
      </div>
    </div>
  );
}
