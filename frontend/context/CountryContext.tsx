'use client';

import React, {
  createContext, useContext, useState, useEffect,
  useTransition, useCallback, useRef,
} from 'react';
import { Country, Currency } from '@/lib/types';
import { getCurrency, getLocations } from '@/lib/utils';
import { setCountrySwitching } from '@/lib/countrySwitch';
import { useSiteConfig } from '@/context/SiteConfigContext';

interface CountryContextType {
  country:       Country;
  currency:      Currency;
  locations:     string[];
  setCountry:    (c: Country) => void;
  isSwitching:   boolean;
  lastSelection: 'auto' | 'manual' | null;
  /** Countries currently enabled on the storefront (admin-configurable from
   *  /admin/settings). Country switcher UIs should filter their option list
   *  to this set instead of hardcoding all four countries. */
  enabledCountries: Country[];
}

const CountryContext = createContext<CountryContextType | undefined>(undefined);

const VALID_COUNTRIES: Country[] = ['UAE', 'UGANDA', 'KENYA', 'CHINA'];

// Launch default — used until the admin-configured list loads from
// /api/public/site-config, and as the final fallback if that ever comes
// back empty. Keep in sync with SiteConfig.enabledCountries' DB default.
const DEFAULT_ENABLED_COUNTRIES: Country[] = ['UGANDA'];

const ISO_TO_COUNTRY: Record<string, Country> = {
  AE: 'UAE', UG: 'UGANDA', KE: 'KENYA', CN: 'CHINA',
};

async function detectCountryFromIP(): Promise<Country | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const code = (data.country_code || '').toUpperCase();
    return ISO_TO_COUNTRY[code] ?? null;
  } catch {
    return null;
  }
}

function readStoredCountry(): Country | null {
  try {
    const cookieMatch = document.cookie.match(/(?:^|; )selectedCountry=([^;]+)/);
    const cookieVal = cookieMatch ? decodeURIComponent(cookieMatch[1]) as Country : null;
    if (cookieVal && VALID_COUNTRIES.includes(cookieVal)) return cookieVal;
    const ls = localStorage.getItem('selectedCountry') as Country | null;
    if (ls && VALID_COUNTRIES.includes(ls)) return ls;
  } catch { /* ignore */ }
  return null;
}

function persistCountry(c: Country) {
  try {
    localStorage.setItem('selectedCountry', c);
    document.cookie = `selectedCountry=${encodeURIComponent(c)};path=/;max-age=31536000;SameSite=Lax`;
  } catch { /* ignore */ }
}

export function CountryProvider({ children }: { children: React.ReactNode }) {
  const { enabledCountries: configEnabledCountries } = useSiteConfig();
  // Filter+validate whatever the admin saved so a stale/bad value in the DB
  // can never leave the storefront with zero selectable countries.
  const enabledCountries = configEnabledCountries.filter((c): c is Country => VALID_COUNTRIES.includes(c as Country));
  const effectiveEnabled = enabledCountries.length > 0 ? enabledCountries : DEFAULT_ENABLED_COUNTRIES;

  const [country, setCountryState] = useState<Country>(DEFAULT_ENABLED_COUNTRIES[0]);
  const [lastSelection, setLastSelection] = useState<'auto' | 'manual' | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [, startTransition] = useTransition();
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = readStoredCountry();
    if (stored && effectiveEnabled.includes(stored)) { setCountryState(stored); return; }
    // Stored/detected country isn't (or is no longer) enabled — e.g. it was
    // picked before the admin restricted the storefront to Uganda. Fall back
    // to the first enabled country instead of trusting stale state.
    if (stored && !effectiveEnabled.includes(stored)) {
      setCountryState(effectiveEnabled[0]);
      persistCountry(effectiveEnabled[0]);
      return;
    }
    // Skip IP auto-detection entirely when only one country is enabled —
    // there's nothing to detect between.
    if (effectiveEnabled.length === 1) {
      setCountryState(effectiveEnabled[0]);
      return;
    }
    detectCountryFromIP().then((detected) => {
      if (detected && effectiveEnabled.includes(detected)) {
        setCountryState(detected);
        setLastSelection('auto');
        persistCountry(detected);
      } else {
        setCountryState(effectiveEnabled[0]);
      }
    });
    // Re-run whenever the enabled-country list finishes loading/changes so a
    // late-arriving site-config response can still correct an out-of-date guess.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveEnabled.join(',')]);

  const setCountry = useCallback((c: Country) => {
    if (c === country) return;

    // Tell the API interceptor to ignore transient 401s during the switch
    setCountrySwitching(true);
    setIsSwitching(true);

    startTransition(() => {
      setCountryState(c);
      setLastSelection('manual');
      persistCountry(c);
    });

    // Clear the flag once the overlay animation finishes (~1.3 s)
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    switchTimerRef.current = setTimeout(() => {
      setIsSwitching(false);
      setCountrySwitching(false);
    }, 1400);
  }, [country]);

  useEffect(() => () => {
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
  }, []);

  return (
    <CountryContext.Provider value={{
      country,
      currency: getCurrency(country),
      locations: getLocations(country),
      setCountry,
      isSwitching,
      lastSelection,
      enabledCountries: effectiveEnabled,
    }}>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry() {
  const ctx = useContext(CountryContext);
  if (!ctx) throw new Error('useCountry must be used within CountryProvider');
  return ctx;
}
