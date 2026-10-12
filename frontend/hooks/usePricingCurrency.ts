'use client';

import { useState, useEffect } from 'react';
import { Currency } from '@/lib/types';
import { API_URL } from '@/lib/apiUrl';

// Uganda-only platform: every price is shown in UGX. Package prices that were
// entered in USD are converted using the admin-configurable rate from
// /api/currency-rates (fallback below).
const FALLBACK_UGX_PER_USD = 3700;

let _cachedRate: number | null = null;
let _cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function fetchUgxRate(): Promise<number> {
  if (_cachedRate && Date.now() < _cacheExpiry) return _cachedRate;
  const res = await fetch(`${API_URL}/api/currency-rates`);
  if (!res.ok) throw new Error('rates fetch failed');
  const data = await res.json() as { base?: string; rates?: { code?: string; rate?: number }[] };
  // Admin-managed table: `rate` = units of that currency per 1 unit of `base`.
  const base = data.base || 'USD';
  const rateOf = (code: string): number | undefined =>
    code === base ? 1 : data.rates?.find((r) => r.code === code)?.rate;
  const ugx = rateOf('UGX');
  const usd = rateOf('USD');
  const rate = ugx && usd && ugx > 0 && usd > 0 ? ugx / usd : FALLBACK_UGX_PER_USD;
  _cachedRate = rate;
  _cacheExpiry = Date.now() + CACHE_TTL;
  return rate;
}

export interface PricingCurrency {
  currency: Currency;
  symbol: string;
  /** Convert a USD amount to UGX (rounded) */
  convert: (usdAmount: number) => number;
  /** Format a USD amount as UGX */
  format: (usdAmount: number) => string;
  loading: boolean;
}

export function usePricingCurrency(): PricingCurrency {
  const [rate, setRate] = useState<number>(FALLBACK_UGX_PER_USD);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchUgxRate()
      .then((r) => { if (!cancelled) setRate(r); })
      .catch(() => { /* keep fallback */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return {
    currency: 'UGX',
    symbol: 'UGX',
    convert: (usd) => Math.round(usd * rate),
    format: (usd) => `UGX ${Math.round(usd * rate).toLocaleString('en-UG')}`,
    loading,
  };
}
