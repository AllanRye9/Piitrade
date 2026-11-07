'use client';

import { useRouter } from 'next/navigation';
import { useLiveRefresh } from '@/lib/liveData';
import { revalidateHomeData } from '@/app/actions/liveRevalidate';

/**
 * Keeps the (server-rendered) home page current without a reload. When the live feed reports a change to
 * listings or categories it drops the page's cached server data and re-renders the page in place:
 * scroll position, open menus and carousels are untouched, and unchanged parts cost no re-render.
 *
 * A short random delay spreads the work when many visitors have the home page open at the same moment.
 * Renders nothing.
 */
export default function HomeLiveRefresh() {
  const router = useRouter();
  useLiveRefresh(async () => {
    await new Promise((r) => setTimeout(r, Math.random() * 1_500));
    await revalidateHomeData();
    router.refresh();
  }, { channel: 'public', topic: ['listings', 'categories'] });
  return null;
}
