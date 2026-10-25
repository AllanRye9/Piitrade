'use client';

/**
 * MomoPayModal — pay with Mobile Money (MTN live, Airtel coming soon).
 *
 * Layout follows the mobile-money checkout used by Ugandan betting sites (betPawa, FortebET):
 * pick the network, see the amount, enter the number with a fixed +256 prefix, approve the PIN
 * prompt on the phone, with a visible "didn't get the prompt?" fallback.
 *
 * Flow: the payer enters their MTN number -> we ask the server to start the payment (the server
 * prices it and sends a PIN prompt to their phone) -> we poll the server until it reports the
 * payment complete. The server confirms with MTN and grants access; this component never decides
 * anything is paid. Closing the window does not cancel a payment already sent — it keeps being
 * settled in the background and access is granted automatically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiErrorMessage, apiErrorStatus, downloadReceiptPdf, fetchMomoPayment, formatMomoAmount, initiateMomoPayment, useMomoConfig,
  type MomoInitiateRequest, type MomoPayment,
} from '@/lib/momo';

type Phase = 'form' | 'starting' | 'waiting' | 'done' | 'failed' | 'review';

const POLL_MS = 3000;
/** Stop actively polling after this long; the server keeps settling it in the background. */
const POLL_GIVE_UP_MS = 6 * 60 * 1000;

/** Local (9-digit, no country code / leading zero) form of an Ugandan number, e.g. 772123456. */
function toLocalDigits(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('256')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 9);
}

/** Airtel Uganda numbers start 070 / 074 / 075 — Airtel Money is not enabled yet. */
function looksLikeAirtel(local: string): boolean {
  return /^(70|74|75)/.test(local);
}

const ACCENTS = {
  red: { badge: 'bg-red-50 text-red-600', amount: 'text-red-700', button: 'bg-red-600 hover:bg-red-700', ring: 'focus:ring-red-300', ringWithin: 'focus-within:ring-red-300' },
  violet: { badge: 'bg-violet-50 text-violet-600', amount: 'text-violet-700', button: 'bg-violet-600 hover:bg-violet-700', ring: 'focus:ring-violet-300', ringWithin: 'focus-within:ring-violet-300' },
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
  /**
   * After a successful payment the page is refreshed so the payer sees their current state (new plan,
   * tier, renewed store…). By default the page fully reloads when the payer leaves the success screen;
   * pass false when the caller navigates somewhere else itself or must not lose on-screen work.
   */
  reloadAfterPayment?: boolean;
}

export function MomoPayModal({ title, amountLabel, accent = 'red', defaultPhone = '', buildRequest, onCompleted, onClose, reloadAfterPayment = true }: MomoPayModalProps) {
  const a = ACCENTS[accent];
  const router = useRouter();
  const { sandbox } = useMomoConfig();
  const [phone, setPhone] = useState(defaultPhone);
  const [phoneTouched, setPhoneTouched] = useState(false);
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
  const paidRef = useRef(false);
  /** Leave the dialog. After a successful payment, also refresh the page so it shows the current state. */
  const leave = useCallback(() => {
    onClose();
    if (paidRef.current && reloadAfterPayment && typeof window !== 'undefined') setTimeout(() => window.location.reload(), 200);
  }, [onClose, reloadAfterPayment]);
  const close = useCallback(() => { if (canClose) leave(); }, [canClose, leave]);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const local = sandbox ? phone.replace(/\D/g, '') : toLocalDigits(phone);
  const airtelNumber = !sandbox && local.length >= 2 && looksLikeAirtel(local);
  const numberValid = sandbox ? local.length >= 9 : local.length === 9 && !airtelNumber;
  // Number sent to the server: full international form (the server accepts any Ugandan spelling).
  const msisdnToSend = sandbox ? phone.trim() : `256${local}`;

  const start = async () => {
    setPhoneTouched(true);
    if (airtelNumber) { setError('Airtel Money is coming soon. Please use an MTN Mobile Money number for now.'); return; }
    if (!numberValid) { setError('Enter the 9-digit MTN Mobile Money number to charge, e.g. 772 123 456.'); return; }
    setError('');
    setPhase('starting');
    try {
      if (!requestRef.current) requestRef.current = await buildRequest();
      const { payment: p } = await initiateMomoPayment(requestRef.current, msisdnToSend);
      setPayment(p);
      setElapsed(0);
      setPollingStopped(false);
      if (p.completed) { finish(p); return; }
      if (p.status === 'FAILED' || p.status === 'EXPIRED' || p.status === 'REFUNDED') { setPhase('failed'); return; }
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
    setPayment(p);
    setPhase('done');
    paidRef.current = true;
    router.refresh(); // re-fetch server data behind this page right away
    if (completedRef.current || !requestRef.current) return;
    completedRef.current = true;
    onCompletedRef.current(p, requestRef.current);
  };

  // The receipt is issued the moment access is granted; if it is not on the payment yet, look again briefly.
  useEffect(() => {
    if (phase !== 'done' || !payment || payment.receiptNumber) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try {
        const fresh = await fetchMomoPayment(payment.id, requestRef.current?.rawToken);
        if (fresh.receiptNumber) setPayment(fresh);
      } catch { /* the receipt also stays available from the profile */ }
      if (tries >= 5) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [phase, payment]);

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
        if (p.status === 'FAILED' || p.status === 'EXPIRED' || p.status === 'REFUNDED') { setPhase('failed'); return; }
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
  const showFormError = phoneTouched && !numberValid && local.length > 0 && !error;

  const stepClass = (state: 'done' | 'active' | 'todo') =>
    state === 'done'
      ? 'bg-emerald-500 text-white'
      : state === 'active'
        ? 'bg-yellow-400 text-gray-900 ring-4 ring-yellow-100'
        : 'bg-gray-100 text-gray-400';
  const Steps = ({ active }: { active: 1 | 2 | 3 | 4 }) => (
    <ol className="mb-4 flex items-start justify-between gap-1 text-center" aria-label="Payment steps">
      {['Enter number', 'Approve on phone', 'Done'].map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const state = n < active ? 'done' : n === active ? 'active' : 'todo';
        return (
          <li key={label} className="flex flex-1 flex-col items-center gap-1">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-extrabold ${stepClass(state)}`} aria-current={state === 'active' ? 'step' : undefined}>
              {state === 'done' ? '✓' : n}
            </span>
            <span className={`text-[10px] leading-tight ${state === 'todo' ? 'text-gray-400' : 'font-semibold text-gray-700'}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={close}>
      <div
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-gray-900">Pay with Mobile Money</h2>
            <p className="mt-0.5 truncate text-sm text-gray-500">{title}</p>
          </div>
          {canClose && (
            <button type="button" onClick={close} aria-label="Close" className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {shownAmount && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Amount to pay</span>
            <span className={`text-xl font-black tabular-nums ${a.amount}`}>{shownAmount}</span>
          </div>
        )}

        {sandbox && (
          <p className="mb-3 rounded-lg bg-amber-100 px-3 py-1.5 text-center text-[11px] font-bold text-amber-800">
            Test mode — no real money moves
          </p>
        )}

        <div aria-live="polite">
          {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          {(phase === 'form' || phase === 'starting') && (
            <>
              {Steps({ active: 1 })}

              <p id="momo-network-label" className="mb-1.5 text-xs font-semibold text-gray-600">Choose network</p>
              <div className="mb-4 grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="momo-network-label">
                <button
                  type="button" role="radio" aria-checked="true"
                  className="relative flex flex-col items-center gap-1 rounded-xl border-2 border-yellow-400 bg-yellow-50 px-2 py-3 text-center"
                >
                  <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-400 text-[10px] font-black text-gray-900" aria-hidden="true">✓</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-400 text-[11px] font-black text-gray-900" aria-hidden="true">MTN</span>
                  <span className="text-xs font-bold text-gray-900">MTN MoMo</span>
                </button>
                <button
                  type="button" role="radio" aria-checked="false" aria-disabled="true" disabled
                  title="Airtel Money is coming soon"
                  className="relative flex cursor-not-allowed flex-col items-center gap-1 rounded-xl border-2 border-gray-200 bg-gray-50 px-2 py-3 text-center opacity-70"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white grayscale" aria-hidden="true">airtel</span>
                  <span className="text-xs font-bold text-gray-500">Airtel Money</span>
                  <span className="rounded-full bg-gray-200 px-2 py-px text-[10px] font-bold uppercase tracking-wide text-gray-600">Coming soon</span>
                </button>
              </div>

              <label htmlFor="momo-phone" className="mb-1 block text-xs font-semibold text-gray-600">MTN Mobile Money number</label>
              <div className={`flex overflow-hidden rounded-xl border bg-white focus-within:ring-2 ${a.ringWithin} ${airtelNumber || showFormError ? 'border-red-300' : 'border-gray-200'}`}>
                <span className="flex shrink-0 items-center gap-1 border-r border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-700">
                  <span aria-hidden="true">🇺🇬</span>{sandbox ? '' : '+256'}
                </span>
                <input
                  id="momo-phone" ref={inputRef} type="tel" inputMode="numeric" autoComplete="tel-national"
                  value={sandbox ? phone : local}
                  onChange={(e) => { setPhone(e.target.value); if (error) setError(''); }}
                  onBlur={() => setPhoneTouched(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && phase === 'form') start(); }}
                  placeholder={sandbox ? 'Test number' : '772 123 456'} disabled={phase === 'starting'} maxLength={sandbox ? 20 : 12}
                  aria-invalid={airtelNumber || showFormError}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base tracking-wide focus:outline-none sm:text-sm"
                />
              </div>
              {airtelNumber ? (
                <p className="mt-1.5 text-[11px] font-medium text-red-600">This looks like an Airtel number. Airtel Money is coming soon — use an MTN MoMo number for now.</p>
              ) : showFormError ? (
                <p className="mt-1.5 text-[11px] font-medium text-red-600">Enter all 9 digits after +256, e.g. 772 123 456.</p>
              ) : (
                <p className="mt-1.5 text-[11px] text-gray-500">
                  We will send a payment request to this number. Approve it by entering your Mobile Money PIN on your phone.
                </p>
              )}
              <button
                type="button" onClick={start} disabled={phase === 'starting' || !numberValid}
                className={`mt-4 w-full rounded-xl py-3 text-sm font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${a.button}`}
              >
                {phase === 'starting' ? 'Sending request…' : amountLabel ? `Pay ${amountLabel} with MTN MoMo` : 'Pay with MTN MoMo'}
              </button>
              <p className="mt-2 text-center text-[10px] text-gray-400">Airtel Money support is coming soon.</p>
            </>
          )}

          {phase === 'waiting' && payment && (
            <div className="text-center">
              {Steps({ active: 2 })}
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-yellow-400" aria-hidden />
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
              <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-left text-[11px] leading-snug text-gray-600">
                <p className="font-semibold text-gray-700">Did not get the prompt?</p>
                <p className="mt-0.5">Dial <b>*165#</b>, sign in with your PIN and open <b>Approvals</b> to approve the pending payment.</p>
                <p className="mt-1 font-medium text-amber-700">Approve it once only — do not start a second payment while this one is pending.</p>
              </div>
              <button type="button" onClick={close} className="mt-4 w-full rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200">
                Close
              </button>
            </div>
          )}

          {phase === 'done' && (
            <div className="text-center">
              {Steps({ active: 4 })} {/* all three steps ticked */}
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600" aria-hidden>✓</div>
              <p className="text-sm font-bold text-gray-900">Payment received</p>
              <p className="mt-1 text-xs text-gray-600">Thank you — it has been applied to your account.</p>

              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-left">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Receipt tracking code</p>
                {payment?.receiptNumber ? (
                  <p className="mt-0.5 select-all break-all font-mono text-base font-extrabold tracking-wide text-emerald-900" data-testid="receipt-code">{payment.receiptNumber}</p>
                ) : (
                  <p className="mt-0.5 text-xs text-emerald-800">Preparing your receipt…</p>
                )}
                <p className="mt-1.5 text-[11px] leading-snug text-emerald-800">
                  A PDF copy is being emailed to you and is saved on your profile under <b>Payment receipts</b>.
                </p>
                {receiptError && <p className="mt-1.5 text-[11px] font-medium text-red-600">{receiptError}</p>}
                <button
                  type="button"
                  disabled={!payment?.receiptNumber || receiptBusy}
                  onClick={async () => {
                    if (!payment) return;
                    setReceiptBusy(true); setReceiptError('');
                    try { await downloadReceiptPdf(payment.id, payment.receiptNumber); }
                    catch (e) { setReceiptError(apiErrorMessage(e, 'We could not download the receipt right now. You can get it from your profile.')); }
                    finally { setReceiptBusy(false); }
                  }}
                  className="mt-2.5 w-full rounded-lg border border-emerald-300 bg-white py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {receiptBusy ? 'Preparing PDF…' : '⬇ Download receipt (PDF)'}
                </button>
              </div>

              <button type="button" onClick={leave} className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
                Done
              </button>
              {reloadAfterPayment && <p className="mt-1.5 text-[10px] text-gray-400">The page refreshes when you press Done so you see your current status.</p>}
            </div>
          )}

          {phase === 'failed' && (
            <div className="text-center">
              <p className="text-sm font-bold text-gray-900">Payment not completed</p>
              <p className="mt-1 text-xs text-gray-600">{payment?.failureMessage ?? 'The payment did not go through.'}</p>
              {payment?.status === 'EXPIRED' && (
                <p className="mt-2 text-xs font-medium text-amber-700">We did not get your approval in time. If you did approve it on your phone, you may still have been charged — check your MoMo messages before trying again, so you do not pay twice.</p>
              )}
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200">Close</button>
                <button type="button" onClick={() => { setPayment(null); setError(''); setPhase('form'); }} className={`flex-1 rounded-xl py-2.5 text-sm font-bold text-white ${a.button}`}>Try again</button>
              </div>
            </div>
          )}

          {phase === 'review' && (
            <div className="text-center">
              <p className="text-sm font-bold text-gray-900">We received your payment</p>
              <p className="mt-1 text-xs text-gray-600">
                It needs a quick manual check before it is applied. You do not need to pay again — our team has been notified and will confirm it shortly.
              </p>
              <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-gray-100 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
