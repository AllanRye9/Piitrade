'use client';

import { useState, useRef, useEffect } from 'react';
import { useCountry } from '@/context/CountryContext';
import { useRouter } from 'next/navigation';
import type { Country } from '@/lib/types';
import { FlagIcon } from '@/components/ui/FlagIcon'; // ✅ added missing import

// Only Uganda is offered here — the platform now operates as a single-country
// (Uganda) marketplace, so this selector no longer needs to list other regions.
const COUNTRY_OPTIONS = [
  { value: 'UGANDA' as Country, flag: '🇺🇬', isoCode: 'UG', label: 'Uganda', full: 'Uganda', slug: 'uganda' },
];

export function CountrySelector({ light = false }: { light?: boolean }) {
  const { country, setCountry } = useCountry();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = COUNTRY_OPTIONS.find((o) => o.value === country) ?? COUNTRY_OPTIONS[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (opt: typeof COUNTRY_OPTIONS[0]) => {
    setCountry(opt.value);
    setOpen(false);
    router.push(`/country/${opt.slug}`);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg border transition-all ${
          light
            ? 'text-gray-800 bg-gray-100 border-gray-300 hover:bg-gray-200 hover:border-gray-400'
            : 'text-white/90 hover:text-white bg-white/10 hover:bg-white/20 border-white/20 hover:border-white/40'
        }`}
      >
        <span
          aria-hidden="true"
          style={{ fontSize: '1.2rem', lineHeight: 1, display: 'inline-block', flexShrink: 0 }}
        >
          <FlagIcon code={selected.isoCode} size={12} className="shrink-0" />
        </span>
        <span>{selected.label}</span>
        <svg
          className={`w-3 h-3 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select country"
          className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-xl shadow-2xl border border-gray-100 z-[200] overflow-hidden animate-scale-in"
        >
          <div className="px-3 py-2 bg-gradient-to-r from-sky-600 to-blue-600">
            <p className="text-[10px] font-bold text-white uppercase tracking-wider">Marketplace Region</p>
          </div>
          {COUNTRY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="option"
              aria-selected={opt.value === country}
              type="button"
              onClick={() => handleSelect(opt)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                opt.value === country
                  ? 'bg-sky-50 text-sky-700 font-semibold border-l-2 border-sky-500'
                  : 'text-gray-700 hover:bg-sky-50/60 border-l-2 border-transparent'
              }`}
            >
              <FlagIcon code={opt.isoCode} size={12} className="shrink-0" />
              <div>
                <div className="font-semibold text-sm">{opt.label}</div>
                <div className="text-[10px] text-gray-400">{opt.full}</div>
              </div>
              {opt.value === country && (
                <svg className="ml-auto w-4 h-4 text-sky-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}