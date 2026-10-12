'use client';

import { useRef, useState, useEffect } from 'react';
import { getLocaleName, getHTMLTextDir } from 'intlayer';
import { useLocale, useIntlayer } from 'next-intlayer';

// Full language names (never ISO codes). Keep in sync with intlayer.config.ts.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  lg: 'Luganda',
  sw: 'Kiswahili',
  ach: 'Acoli',
};
const languageName = (code: string) => LANGUAGE_NAMES[code] ?? getLocaleName(code, code);

export function LocaleSwitcher({ light = false }: { light?: boolean }) {
  const { locale, availableLocales, setLocale } = useLocale();
  const content = useIntlayer('locale-switcher');
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

  // Nothing to switch between with a single configured locale.
  if (availableLocales.length <= 1) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={content.ariaLabel.value}
        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg border transition-all ${
          light
            ? 'text-gray-800 bg-gray-100 border-gray-300 hover:bg-gray-200 hover:border-gray-400'
            : 'text-white/90 hover:text-white bg-white/10 hover:bg-white/20 border-white/20 hover:border-white/40'
        }`}
      >
        <span>{languageName(locale)}</span>
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
          aria-label={content.ariaLabel.value}
          className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-xl shadow-2xl border border-gray-100 z-[200] overflow-hidden animate-scale-in"
        >
          <div className="px-3 py-2 bg-gradient-to-r from-red-600 to-red-600">
            <p className="text-[10px] font-bold text-white uppercase tracking-wider">
              {content.regionLabel}
            </p>
          </div>
          {availableLocales.map((localeItem) => (
            <button
              key={localeItem}
              role="option"
              aria-selected={locale === localeItem}
              type="button"
              dir={getHTMLTextDir(localeItem)}
              onClick={() => {
                setLocale(localeItem);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                locale === localeItem
                  ? 'bg-red-50 text-red-700 font-semibold border-l-2 border-red-500'
                  : 'text-gray-700 hover:bg-red-50/60 border-l-2 border-transparent'
              }`}
            >
              <span className="font-semibold text-sm">{languageName(localeItem)}</span>
              {locale === localeItem && (
                <svg className="w-4 h-4 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
