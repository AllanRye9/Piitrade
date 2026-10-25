'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTr } from '@/lib/i18n/useTr';
import type { PriceOffer } from '@/lib/types';
import { ListingOfferInfo, formatOfferAmount } from '@/lib/offers';
import { MakeOfferModal } from './MakeOfferModal';

interface Props {
  listing: { id: string; title: string; price: number; currency: string };
  seller: { id: string; name: string };
  info: ListingOfferInfo | null;
  onSent: (offer: PriceOffer) => void;
  /** 'panel' = full-width row in the contact card; 'bar' = compact button for the mobile sticky bar. */
  variant: 'panel' | 'bar';
}

/**
 * The listing page's offer entry point. Shows "Make an offer" when allowed, otherwise the state of the
 * buyer's existing negotiation with a link to the chat. Renders nothing when offers are off.
 */
export function ListingOfferAction({ listing, seller, info, onSent, variant }: Props) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  if (!info || info.isOwner) return null;

  const chatHref = `/messages?with=${seller.id}&listing=${listing.id}`;

  if (!info.canOffer) {
    const o = info.offer;
    // The seller declined and the re-offer cooldown is running: say so instead of silently showing nothing.
    if (o?.status === 'DECLINED' && info.reason && variant === 'panel') {
      return <p className="text-center text-xs text-gray-500">💰 {info.reason}.</p>;
    }
    if (!o || (o.status !== 'PENDING' && o.status !== 'ACCEPTED')) return null;
    const label = o.status === 'ACCEPTED'
      ? `${tr('Offer accepted')} · ${formatOfferAmount(o.amount, o.currency)}`
      : `${tr('Your offer')}: ${formatOfferAmount(o.amount, o.currency)}`;
    const tone = o.status === 'ACCEPTED' ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800';
    if (variant === 'bar') {
      return (
        <Link href={chatHref} className={`flex h-11 flex-1 items-center justify-center gap-1 rounded-xl border px-1 text-xs font-bold ${tone}`}>
          💰 {o.status === 'ACCEPTED' ? tr('Accepted') : tr('Offer sent')}
        </Link>
      );
    }
    return (
      <Link href={chatHref} className={`flex items-center justify-between gap-2 w-full px-3 py-2 rounded-xl border text-sm font-semibold ${tone}`}>
        <span className="truncate">💰 {label}</span>
        <span className="text-xs underline flex-shrink-0">{tr('Open chat')}</span>
      </Link>
    );
  }

  return (
    <>
      {variant === 'bar' ? (
        <button type="button" onClick={() => setOpen(true)} className="flex h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50 px-1 text-xs font-bold text-red-700 active:scale-[0.98]">
          💰 {tr('Offer')}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-red-200 bg-white text-red-700 text-sm font-bold hover:bg-red-50 transition-colors">
          💰 {tr('Make an offer')}
        </button>
      )}
      {open && (
        <MakeOfferModal
          listing={listing}
          sellerId={seller.id}
          sellerName={seller.name}
          onClose={() => setOpen(false)}
          onSent={onSent}
        />
      )}
    </>
  );
}
