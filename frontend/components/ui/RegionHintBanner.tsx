'use client';

import { useEffect, useState } from 'react';
import { useCountry } from '@/context/CountryContext';
import Link from 'next/link';
import { FlagIcon } from '@/components/ui/FlagIcon'; // SVG flag — not emoji

const COUNTRY_LABELS: Record<string, { flag: string; isoCode: string; name: string }> = {
  UAE:    { flag: '🇦🇪', isoCode: 'AE', name: 'UAE' },
  UGANDA: { flag: '🇺🇬', isoCode: 'UG', name: 'Uganda' },
  KENYA:  { flag: '🇰🇪', isoCode: 'KE', name: 'Kenya' },
  CHINA:  { flag: '🇨🇳', isoCode: 'CN', name: 'China' },
};

/**
 * Shown once on the homepage to inform visitors that listings are filtered by
 * their automatically detected (or manually selected) country.
 * After 4 seconds it transitions into an advertisement banner of the same height.
 */
export default function RegionHintBanner() {
  const { country } = useCountry();
  const [phase, setPhase] = useState<'hint' | 'ad' | 'hidden'>('hidden');

  useEffect(() => {
    const dismissed = sessionStorage.getItem('regionHintDismissed');
    if (!dismissed) {
      setPhase('hint');
      // Auto-dismiss the region hint after 4 seconds and switch to ad
      const timer = setTimeout(() => {
        setPhase((current) => {
          if (current === 'hint') {
            sessionStorage.setItem('regionHintDismissed', '1');
            return 'ad';
          }
          return current;
        });
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismissAd = () => setPhase('hidden');

  if (phase === 'hidden') return null;

  const info = COUNTRY_LABELS[country] ?? { flag: '🌍', isoCode: null, name: country };

  if (phase === 'hint') {
    return (
      <div className="mx-1 mt-2 flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 shadow-sm animate-fade-down">
        {/* SVG flag — not emoji */}
        {info.isoCode ? (
          <div className="rounded overflow-hidden ring-1 ring-black/10 shrink-0">
            <FlagIcon code={info.isoCode} size={22} />
          </div>
        ) : (
          <span className="text-lg shrink-0">🌍</span>
        )}
        <p className="flex-1">
          <span className="font-semibold">Showing listings for {info.name}.</span>{' '}
          <span className="text-sky-600">Prices shown in your local currency. Use the region selector in the top bar to change country.</span>
        </p>
        <button
          onClick={() => {
            sessionStorage.setItem('regionHintDismissed', '1');
            setPhase('ad');
          }}
          aria-label="Dismiss region hint"
          className="shrink-0 rounded-lg p-1 text-sky-400 hover:text-sky-700 hover:bg-sky-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  // Advertisement banner — same mx/mt/rounded/px/py dimensions as the hint
  return (
    <div className="mx-1 mt-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 px-4 py-2.5 text-sm shadow-sm animate-fade-down overflow-hidden relative">
      <span className="text-lg shrink-0">✨</span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-amber-800 truncate">Advertise with 3R-Elite</p>
        <p className="text-amber-600 text-xs truncate">Reach thousands of premium buyers across UAE, Uganda, Kenya &amp; China.</p>
      </div>
      <Link
        href="/advertising"
        className="shrink-0 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
      >
        Learn More
      </Link>
      <button
        onClick={dismissAd}
        aria-label="Close advertisement"
        className="shrink-0 rounded-lg p-1 text-amber-400 hover:text-amber-700 hover:bg-amber-100 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
