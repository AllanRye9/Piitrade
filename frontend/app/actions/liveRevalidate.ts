'use server';

import { revalidateTag } from 'next/cache';

// Tag carried by every server-side data fetch of the home page (see app/page.tsx getJson).
// (A 'use server' module may only export async functions, so the tag is a local constant.)
const HOME_LIVE_TAG = 'home-live';

let lastRun = 0;
const MIN_GAP_MS = 1_500;

/**
 * Drops the home page's cached data so the next render reads fresh listings, counts and categories.
 *
 * Called by <HomeLiveRefresh> right after the live feed says something changed. It only INVALIDATES a cache
 * (the next render re-reads the public API), it never writes or returns data, so there is nothing to protect
 * beyond load: a visitor-triggered call is throttled to one real invalidation per 1.5 s per server, however
 * many open tabs react to the same change.
 */
export async function revalidateHomeData(): Promise<void> {
  const now = Date.now();
  if (now - lastRun < MIN_GAP_MS) return;
  lastRun = now;
  revalidateTag(HOME_LIVE_TAG);
}
