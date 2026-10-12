/**
 * CountryTransitionOverlay.tsx
 *
 * A full-screen animated overlay that plays whenever the user switches country.
 * Shows the incoming country's flag, name, and flag-colour sweep — works on all
 * screen sizes from mobile to 4 K desktop.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountry } from '@/context/CountryContext';
import type { Country } from '@/lib/types';
import { FlagIcon } from '@/components/ui/FlagIcon'; // SVG flags — not emoji

interface CountryMeta {
  flag:       string;
  isoCode:    string; // ISO 3166-1 alpha-2 for SVG FlagIcon
  name:       string;
  tagline:    string;
  sweepFrom:  string;   // CSS colour — left edge of sweep gradient
  sweepTo:    string;   // CSS colour — right edge
  textColor:  string;
}

const META: Record<Country, CountryMeta> = {
  UGANDA: {
    flag:      '🇺🇬',
    isoCode:   'UG',
    name:      'Uganda',
    tagline:   'Pearl of Africa Marketplace',
    sweepFrom: '#000000',
    sweepTo:   '#FCDC04',
    textColor: '#fff',
  },
};

export function CountryTransitionOverlay() {
  const { country, isSwitching } = useCountry();
  const prevCountryRef = useRef<Country>(country);
  const [active, setActive]   = useState(false);
  const [display, setDisplay] = useState<Country>(country);

  useEffect(() => {
    if (country === prevCountryRef.current) return;
    prevCountryRef.current = country;
    setDisplay(country);
    setActive(true);
    // Dismiss slightly before isSwitching clears (1100 ms < 1400 ms)
    const t = setTimeout(() => setActive(false), 1100);
    return () => clearTimeout(t);
  }, [country]);

  // Also honour isSwitching flag — if it clears before our timer, dismiss early
  useEffect(() => {
    if (!isSwitching && active) {
      const t = setTimeout(() => setActive(false), 300);
      return () => clearTimeout(t);
    }
  }, [isSwitching, active]);

  if (!active) return null;

  const meta = META[display];

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      role="status"
      style={{
        position:   'fixed',
        inset:      0,
        zIndex:     9999,
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        // Animated colour sweep from the incoming country's palette
        background: `linear-gradient(135deg, ${meta.sweepFrom}, ${meta.sweepTo})`,
        animation:  'ctOverlayIn 0.28s cubic-bezier(0.22,1,0.36,1) forwards',
      }}
    >
      {/* Animated content */}
      <div
        style={{
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          gap:            '0.75rem',
          animation:      'ctContentIn 0.35s 0.05s cubic-bezier(0.22,1,0.36,1) both',
          color:          meta.textColor,
          textAlign:      'center',
          padding:        '2rem',
        }}
      >
        {/* SVG flag — replaces emoji, large centered */}
          <div style={{ borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.35)', animation: 'ctFlagBounce 0.45s 0.1s cubic-bezier(0.34,1.56,0.64,1) both' }}>
            <FlagIcon code={meta.isoCode} size={96} />
          </div>

        <div>
          <p
            style={{
              fontSize:   'clamp(1.1rem, 4vw, 2rem)',
              fontWeight: 900,
              letterSpacing: '-0.02em',
              textShadow: '0 2px 12px rgba(0,0,0,0.25)',
              margin:     0,
            }}
          >
            {meta.name}
          </p>
          <p
            style={{
              fontSize:   'clamp(0.75rem, 2.5vw, 1.1rem)',
              fontWeight: 600,
              opacity:    0.85,
              marginTop:  '0.25rem',
            }}
          >
            {meta.tagline}
          </p>
        </div>
      </div>

      {/* Keyframe styles — injected as a style tag so they work without Tailwind */}
      <style>{`
        @keyframes ctOverlayIn {
          0%   { opacity: 0; transform: scale(1.06); }
          18%  { opacity: 1; transform: scale(1);    }
          72%  { opacity: 1; transform: scale(1);    }
          100% { opacity: 0; transform: scale(0.96); }
        }
        @keyframes ctContentIn {
          0%   { opacity: 0; transform: translateY(28px) scale(0.9); }
          100% { opacity: 1; transform: translateY(0)    scale(1);   }
        }
        @keyframes ctFlagBounce {
          0%   { transform: scale(0.5) rotate(-8deg); opacity: 0; }
          60%  { transform: scale(1.12) rotate(3deg); opacity: 1; }
          100% { transform: scale(1)   rotate(0deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
