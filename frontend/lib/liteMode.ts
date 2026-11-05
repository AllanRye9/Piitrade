/**
 * Lite mode: a lighter version of the site for slow or expensive connections.
 *
 *   - lower image quality on listing cards (ListingCard.tsx) and no decorative animation (globals.css),
 *   - switches ON by itself when the browser reports Data Saver or a 2G connection,
 *   - the visitor can always turn it on or off from the footer; that choice is remembered and wins.
 */
export const LITE_KEY = 'piitrade_lite_mode'; // 'on' | 'off' (absent = automatic)

export type LitePref = 'on' | 'off' | 'auto';

interface NetworkInfo { saveData?: boolean; effectiveType?: string }

export function readLitePref(): LitePref {
  try {
    const v = window.localStorage.getItem(LITE_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeLitePref(pref: LitePref): void {
  try {
    if (pref === 'auto') window.localStorage.removeItem(LITE_KEY);
    else window.localStorage.setItem(LITE_KEY, pref);
  } catch { /* storage blocked: the choice just will not persist */ }
}

/** True when the browser says the visitor is saving data or on a 2G-class connection. */
export function connectionIsSlow(): boolean {
  const c = (navigator as Navigator & { connection?: NetworkInfo }).connection;
  if (!c) return false;
  return c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g';
}

export function resolveLite(pref: LitePref): boolean {
  return pref === 'on' ? true : pref === 'off' ? false : connectionIsSlow();
}

/** Reflects the mode on <html> so CSS and the image loader can react without any React plumbing. */
export function applyLite(on: boolean): void {
  const el = document.documentElement;
  if (on) el.setAttribute('data-lite', '1');
  else el.removeAttribute('data-lite');
}

/** True while Lite mode is active. Client-only; call it from components rendered after the page has loaded. */
export function isLiteNow(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-lite') === '1';
}
