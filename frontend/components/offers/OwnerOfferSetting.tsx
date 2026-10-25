'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/momo';
import { useTr } from '@/lib/i18n/useTr';

interface Props {
  listingId: string;
  acceptsOffers: boolean;
  /** Offers currently waiting for the owner's answer. */
  pendingCount: number;
  onChange: (acceptsOffers: boolean) => void;
}

/** Owner-only switch on the listing page: allow or stop price offers on this listing. */
export function OwnerOfferSetting({ listingId, acceptsOffers, pendingCount, onChange }: Props) {
  const tr = useTr();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = !acceptsOffers;
      await api.put(`/price-offers/listing/${encodeURIComponent(listingId)}/settings`, { acceptsOffers: next });
      onChange(next);
    } catch (err) {
      setError(apiErrorMessage(err, tr('Could not save that setting.')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-gray-800">💰 {tr('Accept price offers')}</span>
          <span className="block text-xs text-gray-500">{tr('Buyers can propose a lower price. You can accept, counter or decline.')}</span>
        </span>
        <input type="checkbox" checked={acceptsOffers} onChange={toggle} disabled={saving} className="h-4 w-4 accent-red-600" />
      </label>
      {pendingCount > 0 && (
        <Link href="/messages" className="mt-1.5 inline-block text-xs font-semibold text-red-600 hover:text-red-800">
          {pendingCount} {pendingCount === 1 ? tr('offer is waiting for your answer') : tr('offers are waiting for your answer')} →
        </Link>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
