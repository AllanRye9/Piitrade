'use client';

import { useEffect, useState } from 'react';
import { useCountry } from '@/context/CountryContext';
import { FlagIcon } from '@/components/ui/FlagIcon'; // SVG flag — not emoji

const COUNTRY_LABELS: Record<string, { flag: string; isoCode: string; name: string }> = {
  UGANDA: { flag: '🇺🇬', isoCode: 'UG', name: 'Uganda' },
};

/**
 * Shown once on the homepage to tell visitors which marketplace region (Uganda,
 * priced in UGX) the listings belong to.
 * Auto-dismisses after 4 seconds (or immediately on manual dismiss).
 *
 * NOTE: This previously transitioned into an "Advertise with Piitrade" promo
 * banner after the hint was dismissed. That promo banner has been removed
 * per product decision — the component now simply disappears once the hint
 * has been shown/dismissed, instead of replacing itself with an ad.
 */
export default function RegionHintBanner() {
  const { country } = useCountry();
  const [phase, setPhase] = useState<'hint' | 'hidden'>('hidden');

  useEffect(() => {
    const dismissed = sessionStorage.getItem('regionHintDismissed');
    if (!dismissed) {
      setPhase('hint');
      // Auto-dismiss the region hint after 4 seconds.
      const timer = setTimeout(() => {
        sessionStorage.setItem('regionHintDismissed', '1');
        setPhase('hidden');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (phase === 'hidden') return null;

  const info = COUNTRY_LABELS[country] ?? { flag: '🌍', isoCode: null, name: country };

  return (
    <div className="mx-1 mt-2 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 shadow-sm animate-fade-down">
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
        <span className="text-red-600">All prices are shown in Ugandan shillings (UGX).</span>
      </p>
      <button
        onClick={() => {
          sessionStorage.setItem('regionHintDismissed', '1');
          setPhase('hidden');
        }}
        aria-label="Dismiss region hint"
        className="shrink-0 rounded-lg p-1 text-red-400 hover:text-red-700 hover:bg-red-100 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
