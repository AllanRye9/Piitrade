'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/momo';
import { useTr } from '@/lib/i18n/useTr';
import type { OfferStatus, PriceOffer } from '@/lib/types';
import { MAX_NOTE_LENGTH, formatOfferAmount, parseAmountInput, timeLeft } from '@/lib/offers';

interface Props {
  offer: PriceOffer;
  meId: string;
  /** Called after any action succeeds so the thread can refetch (the card then shows the new status). */
  onChanged: () => void;
}

const BADGE: Record<OfferStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  DECLINED: 'bg-red-100 text-red-700',
  COUNTERED: 'bg-gray-100 text-gray-600',
  WITHDRAWN: 'bg-gray-100 text-gray-600',
  EXPIRED: 'bg-gray-100 text-gray-600',
};

/** A price offer inside the chat thread, with the actions the viewer is allowed to take. */
export function OfferCard({ offer, meId, onChanged }: Props) {
  const tr = useTr();
  const [mode, setMode] = useState<'idle' | 'counter'>('idle');
  const [counter, setCounter] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mine = offer.madeById === meId;
  const isCounter = Boolean(offer.parentId);
  const pending = offer.status === 'PENDING';
  const left = pending ? timeLeft(offer.expiresAt) : null;

  const statusLabel: Record<OfferStatus, string> = {
    PENDING: mine ? tr('Waiting for a reply') : tr('Needs your reply'),
    ACCEPTED: tr('Accepted'),
    DECLINED: tr('Declined'),
    COUNTERED: tr('Countered'),
    WITHDRAWN: tr('Withdrawn'),
    EXPIRED: tr('Expired'),
  };

  const heading = mine
    ? (isCounter ? tr('You countered') : tr('You offered'))
    : (isCounter ? tr('Counter-offer') : tr('Offer received'));

  const act = async (key: string, request: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await request();
      setMode('idle');
      setCounter('');
      setNote('');
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, tr('Something went wrong. Please try again.')));
      // The offer may have changed under us (expired / answered elsewhere): refresh so the card is truthful.
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const respond = (action: 'ACCEPT' | 'DECLINE') => act(action, () => api.post(`/price-offers/${offer.id}/respond`, { action }));
  const withdraw = () => act('WITHDRAW', () => api.post(`/price-offers/${offer.id}/withdraw`));
  const sendCounter = () => {
    const amount = parseAmountInput(counter);
    if (!Number.isFinite(amount)) { setError(tr('Enter your counter-offer as a number.')); return; }
    return act('COUNTER', () => api.post(`/price-offers/${offer.id}/respond`, { action: 'COUNTER', amount, note: note.trim() || undefined }));
  };

  const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50';

  return (
    <div className={`rounded-2xl border bg-white shadow-sm px-3.5 py-3 ${pending && !mine ? 'border-amber-300' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-500">💰 {heading}</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${BADGE[offer.status]}`}>{statusLabel[offer.status]}</span>
      </div>

      <p className="mt-1 text-xl font-extrabold text-gray-900">{formatOfferAmount(offer.amount, offer.currency)}</p>
      {offer.note && <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap break-words">“{offer.note}”</p>}
      {left && <p className="mt-1 text-[11px] text-gray-400">{left}</p>}

      {pending && !mine && mode === 'idle' && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null} onClick={() => respond('ACCEPT')} className={`${btn} bg-green-600 text-white hover:bg-green-700`}>
            {busy === 'ACCEPT' ? '…' : tr('Accept')}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => { setMode('counter'); setError(null); }} className={`${btn} border border-gray-300 text-gray-800 hover:bg-gray-50`}>
            {tr('Counter')}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => respond('DECLINE')} className={`${btn} border border-red-200 text-red-600 hover:bg-red-50`}>
            {busy === 'DECLINE' ? '…' : tr('Decline')}
          </button>
        </div>
      )}

      {pending && !mine && mode === 'counter' && (
        <div className="mt-2.5 space-y-2">
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={counter}
            onChange={(e) => { setCounter(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && busy === null) sendCounter(); }}
            placeholder={`${tr('Your counter')} (${offer.currency})`}
            aria-label={tr('Your counter-offer')}
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-red-200"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            placeholder={tr('Message (optional)')}
            aria-label={tr('Message (optional)')}
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy !== null || counter.trim() === ''} onClick={sendCounter} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
              {busy === 'COUNTER' ? '…' : tr('Send counter')}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => { setMode('idle'); setError(null); }} className={`${btn} border border-gray-200 text-gray-700 hover:bg-gray-50`}>
              {tr('Cancel')}
            </button>
          </div>
        </div>
      )}

      {pending && mine && (
        <div className="mt-2.5">
          <button type="button" disabled={busy !== null} onClick={withdraw} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
            {busy === 'WITHDRAW' ? '…' : tr('Withdraw offer')}
          </button>
        </div>
      )}

      {offer.status === 'ACCEPTED' && (
        <p className="mt-2 text-xs text-green-700">{tr('Agreed. Arrange payment and pick-up or delivery in this chat.')}</p>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
