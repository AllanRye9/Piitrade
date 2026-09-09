'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intlayer';

// Display names shown in the dropdown — intentionally in each language's
// own name (autonym) first, since that's what a reader of that language
// recognizes fastest, with the English name as a hint for everyone else.
// Codes must exactly match the `locales` array in intlayer.config.ts.
const LOCALE_LABELS: Record<string, { autonym: string; english: string }> = {
  en: { autonym: 'English',  english: 'English' },
  lg: { autonym: 'Luganda',  english: 'Luganda' },
  sw: { autonym: 'Kiswahili', english: 'Swahili' },
};

export function LocaleSwitcher({ light = false }: { light?: boolean }) {
  const router = useRouter();
  // Routing is configured as `no-prefix` (see intlayer.config.ts) — every
  // locale resolves to the exact same URL, so the `push`/`replace` options
  // here would navigate to a URL identical to the current one. Next.js
  // treats that as a no-op and never re-requests the server-rendered
  // payload, so server components (which read the locale from a cookie)
  // never actually re-render in the new language. `onChange: 'none'` skips
  // that dead navigation, and `router.refresh()` in `onLocaleChange`
  // re-fetches the current route's server-rendered content with the
  // newly-set locale cookie instead.
  const { locale, setLocale, availableLocales } = useLocale({
    onChange: 'none',
    onLocaleChange: () => router.refresh(),
  });
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Only one locale configured (shouldn't happen given intlayer.config.ts,
  // but mirrors CountrySelector's own guard for the same edge case).
  if (!availableLocales || availableLocales.length <= 1) return null;

  const current = LOCALE_LABELS[locale] ?? { autonym: locale, english: locale };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change language"
        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg border transition-all ${
          light
            ? 'text-gray-800 bg-gray-100 border-gray-300 hover:bg-gray-200 hover:border-gray-400'
            : 'text-white/90 hover:text-white bg-white/10 hover:bg-white/20 border-white/20 hover:border-white/40'
        }`}
      >
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M14 21l3-3.5 3 3.5" />
        </svg>
        <span>{current.autonym}</span>
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
          aria-label="Select language"
          className="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-xl shadow-2xl border border-gray-100 z-[200] overflow-hidden animate-scale-in"
        >
          <div className="px-3 py-2 bg-gradient-to-r from-red-600 to-red-600">
            <p className="text-[10px] font-bold text-white uppercase tracking-wider">Language</p>
          </div>
          {availableLocales.map((loc) => {
            const label = LOCALE_LABELS[loc] ?? { autonym: loc, english: loc };
            const isSelected = loc === locale;
            return (
              <button
                key={loc}
                role="option"
                aria-selected={isSelected}
                type="button"
                onClick={() => { setLocale(loc); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  isSelected
                    ? 'bg-red-50 text-red-700 font-semibold border-l-2 border-red-500'
                    : 'text-gray-700 hover:bg-red-50/60 border-l-2 border-transparent'
                }`}
              >
                <div>
                  <div className="font-semibold text-sm">{label.autonym}</div>
                  {label.autonym !== label.english && (
                    <div className="text-[10px] text-gray-400">{label.english}</div>
                  )}
                </div>
                {isSelected && (
                  <svg className="ml-auto w-4 h-4 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
