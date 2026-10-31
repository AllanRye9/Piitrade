'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useMomoConfig } from '@/lib/momo';
import { MomoPayModal } from '@/components/payments/MomoPayModal';
import { T } from '@/components/ui/T';

interface Unpaid { id: string; title: string; requestedTier: 'GOLD' | 'PLATINUM' }

export const UNPAID_AD_EVENT = 'piitrade:unpaid-ad';
const SNOOZE_KEY = 'piitrade:unpaidAdSnooze';
const SNOOZE_MS = 60 * 60 * 1000; // "Remind me later" = 1 hour

function readSnooze(): Record<string, number> {
  try { return JSON.parse(window.localStorage.getItem(SNOOZE_KEY) || '{}'); } catch { return {}; }
}
function writeSnooze(v: Record<string, number>) {
  try { window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(v)); } catch { /* private mode */ }
}

/**
 * Sitewide reminder for ads that were posted with Gold/Platinum visibility but never paid for.
 * Opens (a) shortly after sign-in / navigation, (b) straight away when a payment window is closed unpaid
 * (dispatch UNPAID_AD_EVENT), and (c) from the "Complete payment" link in the reminder email (?pay=<listingId>).
 * "Remind me later" snoozes that ad for an hour; the server also emails once.
 */
export default function UnpaidAdReminder() {
  const { user } = useAuth();
  const pathname = usePathname();
  const momo = useMomoConfig();
  const [items, setItems] = useState<Unpaid[]>([]);
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async (force = false, focusId?: string) => {
    try {
      const { data } = await api.get('/listings/unpaid');
      const list: Unpaid[] = (data?.listings ?? []).filter((l: Unpaid) => l.requestedTier === 'GOLD' || l.requestedTier === 'PLATINUM');
      setItems(list);
      if (list.length === 0) { setOpen(false); return; }
      const snooze = readSnooze();
      const now = Date.now();
      const due = list.filter((l) => !(snooze[l.id] > now));
      if (force || (focusId && list.some((l) => l.id === focusId)) || due.length > 0) {
        if (focusId) setItems([...list].sort((a) => (a.id === focusId ? -1 : 1)));
        setOpen(true);
      }
    } catch { /* quiet: a reminder must never break a page */ }
  }, []);

  // On sign-in and on route changes (never on the posting page itself, which has its own pay panel).
  useEffect(() => {
    if (!user || user.role === 'ADMIN') { setItems([]); setOpen(false); return; }
    const payId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('pay') || undefined : undefined;
    if (!payId && pathname?.startsWith('/listings/create')) return;
    const t = setTimeout(() => { load(false, payId); }, payId ? 400 : 2500);
    return () => clearTimeout(t);
  }, [user, pathname, load]);

  useEffect(() => {
    const onEvent = () => { if (user) load(true); };
    window.addEventListener(UNPAID_AD_EVENT, onEvent);
    return () => window.removeEventListener(UNPAID_AD_EVENT, onEvent);
  }, [user, load]);

  if (!user || !open || items.length === 0) return null;
  const ad = items[0];
  const tierLabel = ad.requestedTier === 'PLATINUM' ? 'Platinum 💎' : 'Gold 🥇';

  const later = () => {
    const snooze = readSnooze();
    const until = Date.now() + SNOOZE_MS;
    items.forEach((l) => { snooze[l.id] = until; });
    writeSnooze(snooze);
    setOpen(false);
  };

  if (paying) {
    return (
      <MomoPayModal
        reloadAfterPayment={false}
        title={`${ad.requestedTier === 'PLATINUM' ? 'Platinum' : 'Gold'} listing visibility`}
        defaultPhone={user.phone}
        buildRequest={async () => ({ purpose: 'LISTING_TIER', listingId: ad.id, tier: ad.requestedTier })}
        onCompleted={() => { setPaying(false); load(false); }}
        onClose={() => { setPaying(false); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="unpaid-ad-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl animate-slide-up">
        <p className="text-3xl" aria-hidden>⏳</p>
        <h2 id="unpaid-ad-title" className="mt-1 text-base font-extrabold text-gray-900"><T>Your ad payment is still pending</T></h2>
        <p className="mt-1.5 text-sm text-gray-600">
          <span className="font-semibold text-gray-900">&ldquo;{ad.title}&rdquo;</span>{' '}
          <T>was posted with</T> <span className="font-semibold">{tierLabel}</span> <T>visibility but the payment was not completed, so it is showing as a Free listing.</T>
        </p>
        {items.length > 1 && <p className="mt-1 text-xs text-gray-500">+{items.length - 1} <T>more ad(s) waiting for payment</T></p>}
        <div className="mt-4 space-y-2">
          {momo.enabled ? (
            <button type="button" onClick={() => setPaying(true)} className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-white hover:bg-amber-600">
              <T>Pay with MTN MoMo</T>
            </button>
          ) : (
            <Link href="/profile/listings" onClick={() => setOpen(false)} className="block w-full rounded-xl bg-amber-500 py-3 text-center text-sm font-bold text-white hover:bg-amber-600">
              <T>View my listings</T>
            </Link>
          )}
          <button type="button" onClick={later} className="w-full rounded-xl border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <T>Remind me later</T>
          </button>
        </div>
      </div>
    </div>
  );
}
