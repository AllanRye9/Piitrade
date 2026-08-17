'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCountry } from '@/context/CountryContext';
import type { Country } from '@/lib/types';
import { FlagIcon } from '@/components/ui/FlagIcon';
import BrandTagline from '@/components/ui/BrandTagline';

const COUNTRY_SLUGS: Record<string, string> = {
  UAE: 'uae', UGANDA: 'uganda', KENYA: 'kenya', CHINA: 'china',
};

const COUNTRIES: { value: Country; label: string; isoCode: string; desc: string; currency: string; accentColor: string }[] = [
  { value: 'UAE',    isoCode: 'AE', label: 'UAE',    desc: 'United Arab Emirates', currency: 'AED', accentColor: '#C8A951' },
  { value: 'UGANDA', isoCode: 'UG', label: 'Uganda', desc: 'East Africa',           currency: 'UGX', accentColor: '#F5A623' },
  { value: 'KENYA',  isoCode: 'KE', label: 'Kenya',  desc: 'East Africa',           currency: 'KES', accentColor: '#CE1126' },
  { value: 'CHINA',  isoCode: 'CN', label: 'China',  desc: 'Asia Pacific',          currency: 'CNY', accentColor: '#DE2910' },
];

export default function CountrySelectModal() {
  const { country, setCountry, enabledCountries } = useCountry();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Country>(country);

  // Countries the admin has actually turned on. Recomputed on every render
  // (not memoized) since enabledCountries is a small, cheap array from context.
  const visibleCountries = COUNTRIES.filter((c) => enabledCountries.includes(c.value));

  useEffect(() => {
    setSelected(country);
  }, [country]);

  useEffect(() => {
    // Show on first visit only — check localStorage. Also skip the modal
    // entirely when only one country is enabled: there's nothing to choose
    // between, so asking the visitor to "pick a region" is just friction.
    if (visibleCountries.length <= 1) return;
    const saved = typeof window !== 'undefined' ? localStorage.getItem('selectedCountry') : null;
    const seen  = typeof window !== 'undefined' ? localStorage.getItem('welcomePopupSeen')  : null;
    if (!saved && !seen) {
      // Small delay so the page renders first
      const t = setTimeout(() => setOpen(true), 300);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCountries.length]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleConfirm = () => {
    setCountry(selected);
    localStorage.setItem('welcomePopupSeen', '1');
    setOpen(false);
    router.push(`/country/${COUNTRY_SLUGS[selected]}`);
  };

  const handleDismiss = () => {
    localStorage.setItem('welcomePopupSeen', '1');
    setOpen(false);
  };

  if (!open) return null;

  const selectedMeta = COUNTRIES.find((c) => c.value === selected)!;

  return (
    <>
      {/*
        ── The backdrop sits at z-[9998].
        ── Everything on the page behind it gets a blur filter via the
        ── #page-content wrapper (applied in layout.tsx by targeting .modal-open on <body>).
        ── The modal itself is z-[9999] — in front of everything.
      */}

      {/* Full-screen backdrop — blurs content beneath */}
      <div
        className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-md"
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="country-modal-title"
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      >
        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
          style={{ animation: 'modal-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) both' }}
        >
          {/* ── Inline keyframe for the pop animation ── */}
          <style>{`
            @keyframes modal-pop {
              from { opacity: 0; transform: scale(0.88) translateY(16px); }
              to   { opacity: 1; transform: scale(1)    translateY(0);    }
            }
          `}</style>

          {/* Close (X) button — top-right corner */}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close country selector"
            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Header */}
          <div className="bg-gradient-to-br from-sky-700 to-sky-500 px-6 py-6 text-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center text-2xl shadow-inner">
                🌍
              </div>
              <div>
                <h2 id="country-modal-title" className="text-xl font-black tracking-tight leading-tight">
                  Welcome to Piitrade
                </h2>
                <p className="text-xs text-white/70 font-semibold uppercase tracking-wider mt-0.5">
                  <BrandTagline
                    className="text-xs text-white/70 font-semibold uppercase tracking-wider"
                    imgHeight={14}
                  />
                </p>
              </div>
            </div>
            <p className="text-sm text-white/80 leading-relaxed mt-3">
              Select your country to see prices in your currency and listings from your region.
            </p>
          </div>

          {/* Country grid */}
          <div className="p-5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Choose your shopping region
            </p>

            <div className="grid grid-cols-2 gap-3 mb-5">
              {visibleCountries.map((c) => {
                const isSelected = selected === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setSelected(c.value)}
                    className={`group relative flex items-center gap-3 p-3.5 rounded-2xl border-2 text-left transition-all duration-200 ${
                      isSelected
                        ? 'border-sky-500 bg-sky-50 shadow-md'
                        : 'border-gray-100 bg-gray-50 hover:border-sky-200 hover:bg-sky-50/40 hover:shadow-sm'
                    }`}
                  >
                    {/* Flag */}
                    <div className="shrink-0 rounded-lg overflow-hidden shadow-sm ring-1 ring-black/10">
                      <FlagIcon code={c.isoCode} size={28} />
                    </div>

                    {/* Labels */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold leading-tight truncate ${isSelected ? 'text-sky-700' : 'text-gray-900'}`}>
                        {c.label}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{c.desc}</p>
                      <p className={`text-[10px] font-bold mt-0.5 ${isSelected ? 'text-sky-600' : 'text-gray-400'}`}>
                        {c.currency}
                      </p>
                    </div>

                    {/* Tick */}
                    {isSelected && (
                      <span className="shrink-0 text-sky-500">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Confirm CTA */}
            <button
              type="button"
              onClick={handleConfirm}
              className="w-full py-3.5 rounded-2xl font-bold text-sm text-white transition-all shadow-lg hover:shadow-xl hover:brightness-105 active:scale-[0.98] flex items-center justify-center gap-2"
              style={{ backgroundColor: selectedMeta.accentColor }}
            >
              <FlagIcon code={selectedMeta.isoCode} size={16} className="rounded-sm overflow-hidden" />
              Continue with {selectedMeta.label} ({selectedMeta.currency})
            </button>

            <p className="mt-2.5 text-center text-[11px] text-gray-400">
              You can change your region anytime from the header ·{' '}
              <button
                type="button"
                onClick={handleDismiss}
                className="underline hover:text-gray-600 transition-colors"
              >
                Skip for now
              </button>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
