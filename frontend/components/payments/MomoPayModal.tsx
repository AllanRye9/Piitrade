'use client';

/**
 * MomoPayModal — pay with MTN Mobile Money.
 *
 * Flow: the payer enters their MTN number -> we ask the server to start the payment (the server
 * prices it and sends a PIN prompt to their phone) -> we poll the server until it reports the
 * payment complete. The server confirms with MTN and grants access; this component never decides
 * anything is paid. Closing the window does not cancel a payment already sent — it keeps being
 * settled in the background and access is granted automatically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiErrorMessage, apiErrorStatus, fetchMomoPayment, formatMomoAmount, initiateMomoPayment, useMomoConfig,
  type MomoInitiateRequest, type MomoPayment,
} from '@/lib/momo';

type Phase = 'form' | 'starting' | 'waiting' | 'done' | 'failed' | 'review';

const POLL_MS = 3000;
/** Stop actively polling after this long; the server keeps settling it in the background. */
const POLL_GIVE_UP_MS = 6 * 60 * 1000;

const ACCENTS = {
  red: { badge: 'bg-red-50 text-red-600', amount: 'text-red-700', button: 'bg-red-600 hover:bg-red-700', ring: 'focus:ring-red-300' },
  violet: { badge: 'bg-violet-50 text-violet-600', amount: 'text-violet-700', button: 'bg-violet-600 hover:bg-violet-700', ring: 'focus:ring-violet-300' },
} as const;

export interface MomoPayModalProps {
  /** What is being paid for, e.g. "Gold listing" or "CV download". */
  title: string;
  /** Display-only price shown before the payment starts (the server decides the real charge). */
  amountLabel?: string;
  accent?: keyof typeof ACCENTS;
  /** Prefill the number field (e.g. the account's phone). */
  defaultPhone?: string;
  /**
   * What to buy, minus the phone number. Called when the payer taps Pay; may create things first
   * (e.g. the CV download token). Its result is reused if the payer retries inside this window.
   */
  buildRequest: () => Promise<MomoInitiateRequest>;
  /** Called once, when the server reports the payment complete and access granted. */
  onCompleted: (payment: MomoPayment, request: MomoInitiateRequest) => void;
  onClose: () => void;
}

export function MomoPayModal({ title, amountLabel, accent = 'red', defaultPhone = '', buildRequest, onCompleted, onClose }: MomoPayModalProps) {
  const a = ACCENTS[accent];
  const { sandbox } = useMomoConfig();
  const [phone, setPhone] = useState(defaultPhone);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [payment, setPayment] = useState<MomoPayment | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pollingStopped, setPollingStopped] = useState(false);
  const requestRef = useRef<MomoInitiateRequest | null>(null);
  const completedRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = 'momo-pay-title';

  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);
  useEffect(() => { if (phase === 'form') inputRef.current?.focus(); }, [phase]);

  const canClose = phase !== 'starting';
  const close = useCallback(() => { if (canClose) onClose(); }, [canClose, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const start = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9) { setError('Enter the MTN Mobile Money number to charge, e.g. 0772 123 456.'); return; }
    setError('');
    setPhase('starting');
    try {
      if (!requestRef.current) requestRef.current = await buildRequest();
      const { payment: p } = await initiateMomoPayment(requestRef.current, phone.trim());
      setPayment(p);
      setElapsed(0);
      setPollingStopped(false);
      if (p.completed) { finish(p); return; }
      if (p.status === 'FAILED' || p.status === 'EXPIRED') { setPhase('failed'); return; }
      if (p.status === 'NEEDS_REVIEW') { setPhase('review'); return; }
      setPhase('waiting');
    } catch (e) {
      const status = apiErrorStatus(e);
      if (status === 404 || status === 410) requestRef.current = null; // the prepared item is gone: rebuild on retry
      setError(apiErrorMessage(e, 'We could not start the payment. Please try again.'));
      setPhase('form');
    }
  };

  const finish = (p: MomoPayment) => {
    setPhase('done');
    if (completedRef.current || !requestRef.current) return;
    completedRef.current = true;
    onCompletedRef.current(p, requestRef.current);
  };

  // Poll the server while we are waiting for the payer to approve on their phone.
  const paymentId = payment?.id;
  useEffect(() => {
    if (phase !== 'waiting' || !paymentId) return;
    let alive = true;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!alive) return;
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      try {
        const p = await fetchMomoPayment(paymentId, requestRef.current?.rawToken);
        if (!alive) return;
        setPayment(p);
        if (p.completed) { finish(p); return; }
        if (p.status === 'FAILED' || p.status === 'EXPIRED') { setPhase('failed'); return; }
        if (p.status === 'NEEDS_REVIEW') { setPhase('review'); return; }
      } catch (e) {
        if (!alive) return;
        if (apiErrorStatus(e) === 404) { setError('This payment could not be found.'); setPhase('failed'); return; }
        // any other error is transient (network blip): keep polling
      }
      if (Date.now() - startedAt > POLL_GIVE_UP_MS) { setPollingStopped(true); return; }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { alive = false; clearTimeout(timer); };
    // `finish` only touches refs and setters, so it is safe to leave out of the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paymentId]);

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const shownAmount = payment ? formatMomoAmount(payment.currency, payment.amount) : amountLabel;

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={close}>
      <div
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-sm rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 text-center">
          <div className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${a.badge}`} aria-hidden>📱</div>
          <h2 id={titleId} className="text-lg font-bold text-gray-900">Pay with MTN Mobile Money</h2>
          <p className="mt-0.5 text-sm text-gray-500">{title}</p>
          {shownAmount && <p className={`mt-1 text-2xl font-black ${a.amount}`}>{shownAmount}</p>}
          {sandbox && (
            <p className="mx-auto mt-2 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
              Test mode — no real money moves
            </p>
          )}
        </div>

        <div aria-live="polite">
          {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          {(phase === 'form' || phase === 'starting') && (
            <>
              <label htmlFor="momo-phone" className="mb-1 block text-xs font-semibold text-gray-600">MTN Mobile Money number</label>
              <input
                id="momo-phone" ref={inputRef} type="tel" inputMode="tel" autoComplete="tel" value={phone}
                onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && phase === 'form') start(); }}
                placeholder="0772 123 456" disabled={phase === 'starting'} maxLength={20}
                className={`w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${a.ring}`}
              />
              <p className="mt-1.5 text-[11px] text-gray-500">
                We will send a payment request to this number. Approve it by entering your Mobile Money PIN on your phone.
              </p>
              <button
                type="button" onClick={start} disabled={phase === 'starting'}
                className={`mt-4 w-full rounded-xl py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-60 ${a.button}`}
              >
                {phase === 'starting' ? 'Sending request…' : amountLabel ? `Pay ${amountLabel}` : 'Pay now'}
              </button>
            </>
          )}

          {phase === 'waiting' && payment && (
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-amber-500" aria-hidden />
              <p className="text-sm font-semibold text-gray-900">Check your phone</p>
              <p className="mt-1 text-xs text-gray-600">
                We sent a payment request to <b>{payment.msisdn}</b>. Enter your Mobile Money PIN to approve it.
              </p>
              {pollingStopped ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Still waiting for approval. You can close this window — if you approve later, it will be applied automatically.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-gray-400">Waiting for approval… {mmss}</p>
              )}
              <button type="button" onClick={close} className="mt-4 w-full rounded-xl bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
                Close
              </button>
            </div>
          )}

          {phase === 'done' && (
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600" aria-hidden>✓</div>
              <p className="text-sm font-bold text-gray-900">Payment received</p>
              <p className="mt-1 text-xs text-gray-600">Thank you — it has been applied to your account.</p>
              <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                Done
              </button>
            </div>
          )}

          {phase === 'failed' && (
            <div className="text-center">
              <p className="text-sm font-bold text-gray-900">Payment not completed</p>
              <p className="mt-1 text-xs text-gray-600">{payment?.failureMessage ?? 'The payment did not go through. You have not been charged.'}</p>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Close</button>
                <button type="button" onClick={() => { setPayment(null); setError(''); setPhase('form'); }} className={`flex-1 rounded-xl py-2 text-sm font-bold text-white ${a.button}`}>Try again</button>
              </div>
            </div>
          )}

          {phase === 'review' && (
            <div className="text-center">
              <p className="text-sm font-bold text-gray-900">We received your payment</p>
              <p className="mt-1 text-xs text-gray-600">
                It needs a quick manual check before it is applied. You do not need to pay again — our team has been notified and will confirm it shortly.
              </p>
              <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
