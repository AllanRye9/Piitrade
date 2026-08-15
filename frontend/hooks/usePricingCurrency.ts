'use client';

import { useState, useEffect } from 'react';
import { Currency } from '@/lib/types';
import { useCountry } from '@/context/CountryContext';
import { apiPath } from '@/lib/apiUrl';

// Approximate exchange rates from USD — used as fallback when API is unavailable.
// The live rates come from /api/currency-rates (admin-configurable).
const USD_RATES: Record<Currency, number> = {
  USD: 1,
  AED: 3.67,
  UGX: 3700,
  KES: 130,
  CNY: 7.2,
};

// Module-level cache so multiple components share one fetch
let _cachedRates: Record<string, number> | null = null;
let _cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchLiveRates(): Promise<Record<string, number>> {
  if (_cachedRates && Date.now() < _cacheExpiry) return _cachedRates;
  const res = await fetch(apiPath('/api/currency-rates'));
  if (!res.ok) throw new Error('rates fetch failed');
  const data = await res.json();
  const map: Record<string, number> = { USD: 1 };
  for (const r of (data.rates ?? [])) {
    if (r.code && typeof r.rate === 'number') map[r.code] = r.rate;
  }
  _cachedRates = map;
  _cacheExpiry = Date.now() + CACHE_TTL;
  return map;
}

// Map our Country enum to Currency
const COUNTRY_TO_CURRENCY: Record<string, Currency> = {
  UAE: 'AED',
  UGANDA: 'UGX',
  KENYA: 'KES',
  CHINA: 'CNY',
};

// Map ISO country codes (from IP geo) to Currency
const ISO_COUNTRY_TO_CURRENCY: Record<string, Currency> = {
  AE: 'AED',
  UG: 'UGX',
  KE: 'KES',
  CN: 'CNY',
};

export interface PricingCurrency {
  currency: Currency;
  symbol: string;
  /** Convert a USD amount to the local currency (rounded for display) */
  convert: (usdAmount: number) => number;
  /** Format a converted amount with currency symbol */
  format: (usdAmount: number) => string;
  loading: boolean;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: '$',
  AED: 'AED',
  UGX: 'UGX',
  KES: 'KES',
  CNY: '¥',
};

function formatConverted(amount: number, currency: Currency): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (currency === 'UGX' || currency === 'KES') {
    return `${symbol} ${Math.round(amount).toLocaleString()}`;
  }
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function usePricingCurrency(): PricingCurrency {
  const { country } = useCountry();
  const [fallbackCurrency, setFallbackCurrency] = useState<Currency>('USD');
  const [liveRates, setLiveRates] = useState<Record<string, number>>(USD_RATES);
  const [loading, setLoading] = useState(true);

  // Derive currency from the user's selected country; fall back to IP geo result (or USD)
  const currency: Currency = COUNTRY_TO_CURRENCY[country] ?? fallbackCurrency;

  // Load live rates from backend on mount (shared 5-min cache across all usages)
  useEffect(() => {
    let cancelled = false;
    fetchLiveRates()
      .then((rates) => { if (!cancelled) setLiveRates(rates); })
      .catch(() => { /* keep USD_RATES fallback */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // If the selected country already maps to a currency, no IP lookup is needed
    if (COUNTRY_TO_CURRENCY[country]) {
      setLoading(false);
      return;
    }

    // No mapped country — attempt IP geolocation as a fallback (USD default)
    let cancelled = false;
    async function detectFallback() {
      try {
        const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(2000) });
        if (!res.ok) throw new Error('geo failed');
        const data = await res.json() as { country_code?: string };
        const code = data.country_code?.toUpperCase();
        if (code && !cancelled) {
          setFallbackCurrency(ISO_COUNTRY_TO_CURRENCY[code] ?? 'USD');
        }
      } catch {
        // Default to USD on any error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    detectFallback();
    return () => { cancelled = true; };
  }, [country]);

  // Use live rate from backend when available, fall back to static table
  const rate = liveRates[currency] ?? USD_RATES[currency] ?? 1;

  return {
    currency,
    symbol: CURRENCY_SYMBOLS[currency],
    convert: (usdAmount: number) => Math.round(usdAmount * rate * 100) / 100,
    format: (usdAmount: number) => formatConverted(usdAmount * rate, currency),
    loading,
  };
}
