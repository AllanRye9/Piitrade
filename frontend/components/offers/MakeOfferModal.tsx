'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/momo';
import { useTr } from '@/lib/i18n/useTr';
import type { PriceOffer } from '@/lib/types';
import { MAX_NOTE_LENGTH, MIN_OFFER_RATIO, formatOfferAmount, parseAmountInput, suggestOffers } from '@/lib/offers';

interface Props {
  listing: { id: string; title: string; price: number; currency: string };
  sellerId: string;
  sellerName: string;
  onClose: () => void;
  /** Called after the offer is created, before navigating to the chat. */
  onSent?: (offer: PriceOffer) => void;
}

/** Dialog where a buyer proposes a price. On success the buyer lands in the chat, where the offer appears as a card. */
export function MakeOfferModal({ listing, sellerId, sellerName, onClose, onSent }: Props) {
  const tr = useTr();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Latest callbacks/flags live in refs so the effect below runs exactly once. (Depending on `onClose`
  // directly would re-run it, and re-focus the amount field, every time the parent page re-renders —
  // yanking focus away while the buyer is typing their note.)
  const onCloseRef = useRef(onClose);
  const sendingRef = useRef(sending);
  onCloseRef.current = onClose;
  sendingRef.current = sending;

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sendingRef.current) onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, []);

  const amount = parseAmountInput(amountText);
  const suggestions = suggestOffers(listing.price);

  const clientError = (): string | null => {
    if (!Number.isFinite(amount)) return tr('Enter your offer as a number.');
    if (amount >= listing.price) return tr('Your offer must be below the asking price. To pay the full price, message the seller.');
    if (amount < listing.price * MIN_OFFER_RATIO) return tr('That offer is too low to be taken seriously.');
    return null;
  };

  const submit = async () => {
    const problem = clientError();
    if (problem) { setError(problem); return; }
    setSending(true);
    setError(null);
    try {
      const { data } = await api.post<{ offer: PriceOffer }>('/price-offers', {
        listingId: listing.id, amount, note: note.trim() || undefined,
      });
      onSent?.(data.offer);
      try { sessionStorage.setItem(`chat-start:${sellerId}`, sellerName); } catch { /* private mode — no name hint, fine */ }
      router.push(`/messages?with=${sellerId}&listing=${listing.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tr('Could not send your offer. Please try again.')));
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="offer-title" className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-4 sm:p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="offer-title" className="text-base font-bold text-gray-900">{tr('Make an offer')}</h2>
            <p className="text-xs text-gray-500 truncate">{listing.title}</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label={tr('Close')} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1">×</button>
        </div>

        <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-gray-500">{tr('Asking price')}</span>
          <span className="text-sm font-bold text-gray-900">{formatOfferAmount(listing.price, listing.currency)}</span>
        </div>

        <label htmlFor="offer-amount" className="mt-3 block text-xs font-semibold text-gray-700">{tr('Your offer')} ({listing.currency})</label>
        <input
          id="offer-amount"
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amountText}
          onChange={(e) => { setAmountText(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !sending) submit(); }}
          placeholder={suggestions[1] ? String(suggestions[1]) : ''}
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-red-200"
        />

        {suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setAmountText(String(s)); setError(null); }}
                className="px-2.5 py-1 rounded-full border border-gray-200 text-xs font-medium text-gray-700 hover:border-red-300 hover:bg-red-50"
              >
                {s.toLocaleString('en-US')}
              </button>
            ))}
          </div>
        )}

        <label htmlFor="offer-note" className="mt-3 block text-xs font-semibold text-gray-700">{tr('Message (optional)')}</label>
        <textarea
          id="offer-note"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
          rows={2}
          placeholder={tr('e.g. I can pick it up today')}
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-200"
        />

        {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}

        <p className="mt-2 text-[11px] text-gray-400">{tr('The seller has 48 hours to accept, decline or counter. You can withdraw your offer any time before they answer.')}</p>

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onClose} disabled={sending} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {tr('Cancel')}
          </button>
          <button type="button" onClick={submit} disabled={sending || amountText.trim() === ''} className="flex-[2] px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50">
            {sending ? tr('Sending…') : tr('Send offer')}
          </button>
        </div>
      </div>
    </div>
  );
}
