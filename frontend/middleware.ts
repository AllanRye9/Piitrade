import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const VALID = {
  AE: 'UAE',
  UG: 'UGANDA',
  KE: 'KENYA',
  CN: 'CHINA',
} as const;

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  UAE: 'AED',
  UGANDA: 'UGX',
  KENYA: 'KES',
  CHINA: 'CNY',
};

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();

  // If cookie already set, do nothing
  const existing = req.cookies.get('selectedCountry');
  if (existing) return NextResponse.next();

  // Try to use built-in geo if available
  try {
    const geo = (req as any).geo as { country?: string } | undefined;
    const countryCode = (geo?.country || '').toUpperCase();
    const mapped = VALID[countryCode as keyof typeof VALID];
    if (mapped) {
      const res = NextResponse.next();
      const currency = COUNTRY_TO_CURRENCY[mapped] ?? 'USD';
      res.cookies.set('selectedCountry', mapped, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
      res.cookies.set('selectedCurrency', currency, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
      // mark selection as auto
      res.cookies.set('lastSelection', 'auto', { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
      return res;
    }
  } catch {
    // ignore
  }

  // Fallback: perform a lightweight IP geolocation request server-side
  try {
    const ipRes = await fetch('https://ipapi.co/json/', { method: 'GET', headers: { Accept: 'application/json' } });
    if (ipRes.ok) {
      const data = await ipRes.json();
      const code = (data.country_code || '').toUpperCase();
      const mapped = VALID[code as keyof typeof VALID];
      if (mapped) {
        const res = NextResponse.next();
        const currency = COUNTRY_TO_CURRENCY[mapped] ?? 'USD';
        res.cookies.set('selectedCountry', mapped, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
        res.cookies.set('selectedCurrency', currency, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
        res.cookies.set('lastSelection', 'auto', { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
        return res;
      }
    }
  } catch {
    // ignore
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/cart', '/checkout', '/(.*)'],
};
