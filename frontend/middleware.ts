import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { intlayerMiddleware, multipleMiddlewares } from 'next-intlayer/middleware';

// Uganda-only marketplace: country and currency are fixed, no geo lookup.
async function countryMiddleware(req: NextRequest) {
  const existing = req.cookies.get('selectedCountry');
  if (existing?.value === 'UGANDA' && req.cookies.get('selectedCurrency')?.value === 'UGX') {
    return NextResponse.next();
  }
  const res = NextResponse.next();
  const opts = { path: '/', httpOnly: false, sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 30 };
  res.cookies.set('selectedCountry', 'UGANDA', opts);
  res.cookies.set('selectedCurrency', 'UGX', opts);
  return res;
}

// Chains the existing country/currency detection with Intlayer's locale
// detection (cookie / Accept-Language, since intlayer.config.ts uses
// `routing.mode: "no-prefix"` — no URL redirect happens). Order doesn't
// matter here since neither middleware short-circuits the other's cookies.
export const middleware = multipleMiddlewares([
  intlayerMiddleware,
  countryMiddleware,
]);

export const config = {
  matcher: ['/', '/(.*)'],
};
