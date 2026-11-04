'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/utils';

export type WipeScope = 'VISITOR_LOGS' | 'SEARCH_LOGS' | 'CLICK_LOGS' | 'ALL';

const SCOPE_LABEL: Record<WipeScope, string> = {
  VISITOR_LOGS: 'Visitor Logs',
  SEARCH_LOGS: 'Search Logs',
  CLICK_LOGS: 'Item Clicks',
  ALL: 'All logs (Visitor, Search & Item Clicks)',
};

interface WipeResult {
  visitorLogs: number;
  searchLogs: number;
  clickLogs: number;
}

type Step = 'choose' | 'code' | 'done';

/**
 * "Clear logs" button + confirmation dialog for the admin log pages.
 * Nothing is deleted without an emailed one-time code: step 1 sends the code to the signed-in admin's
 * address, step 2 needs that code AND the word DELETE.
 */
export default function ClearLogsButton({ scope: pageScope, onCleared }: { scope: Exclude<WipeScope, 'ALL'>; onCleared: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('choose');
  const [scope, setScope] = useState<WipeScope>(pageScope);
  const [challengeId, setChallengeId] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [result, setResult] = useState<WipeResult | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep('choose');
    setScope(pageScope);
    setChallengeId('');
    setSentTo('');
    setCode('');
    setConfirmText('');
    setBusy(false);
    setError('');
    setCooldown(0);
    setResult(null);
  }, [pageScope]);

  const close = useCallback(() => {
    setOpen(false);
    if (step === 'done') onCleared();
    reset();
  }, [step, onCleared, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, close]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  const requestCode = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/admin/logs/wipe/request', { scope });
      setChallengeId(data.challengeId);
      setSentTo(data.sentTo);
      setCooldown(data.cooldownSeconds ?? 30);
      setCode('');
      setConfirmText('');
      setStep('code');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not send the confirmation code.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmWipe = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/admin/logs/wipe/confirm', { challengeId, code: code.trim(), scope, confirmText });
      setResult(data.deleted as WipeResult);
      setStep('done');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not clear the logs.'));
    } finally {
      setBusy(false);
    }
  };

  const canConfirm = /^\d{6}$/.test(code.trim()) && confirmText === 'DELETE' && !busy;

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Clear logs
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="clear-logs-title" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 id="clear-logs-title" className="text-base font-bold text-gray-900">
                {step === 'done' ? 'Logs cleared' : 'Clear logs permanently'}
              </h2>
              <button type="button" onClick={close} disabled={busy} className="-mr-1 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40" aria-label="Close">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {step === 'choose' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
                  This permanently deletes the selected log records. It cannot be undone. For your security a confirmation code is
                  emailed to your admin address first, and nothing is deleted without it.
                </div>
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">What to clear</legend>
                  {([pageScope, 'ALL'] as WipeScope[]).map((s) => (
                    <label key={s} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${scope === s ? 'border-red-300 bg-red-50 text-red-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                      <input type="radio" name="wipe-scope" checked={scope === s} onChange={() => setScope(s)} className="accent-red-600" />
                      <span>{SCOPE_LABEL[s]}</span>
                    </label>
                  ))}
                </fieldset>
                {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={close} className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button type="button" onClick={requestCode} disabled={busy} className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    {busy ? 'Sending…' : 'Email me a code'}
                  </button>
                </div>
              </div>
            )}

            {step === 'code' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  We sent a 6-digit code to <strong className="text-gray-900">{sentTo}</strong>. It expires in 10 minutes.
                  You are clearing <strong className="text-gray-900">{SCOPE_LABEL[scope]}</strong>.
                </p>
                <div>
                  <label htmlFor="wipe-code" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Email code</label>
                  <input
                    id="wipe-code"
                    ref={codeRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center font-mono text-xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                <div>
                  <label htmlFor="wipe-confirm" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Type DELETE to confirm</label>
                  <input
                    id="wipe-confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoComplete="off"
                    placeholder="DELETE"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  />
                </div>
                {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button type="button" onClick={requestCode} disabled={busy || cooldown > 0} className="text-xs text-gray-500 underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60">
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                  </button>
                  <div className="flex gap-2">
                    <button type="button" onClick={close} disabled={busy} className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                    <button type="button" onClick={confirmWipe} disabled={!canConfirm} className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
                      {busy ? 'Deleting…' : 'Delete permanently'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === 'done' && result && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">The selected logs were deleted. The action was recorded in the admin audit log.</p>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
                  {[
                    { label: 'Visitor Logs', n: result.visitorLogs, show: scope === 'ALL' || scope === 'VISITOR_LOGS' },
                    { label: 'Search Logs', n: result.searchLogs, show: scope === 'ALL' || scope === 'SEARCH_LOGS' },
                    { label: 'Item Clicks', n: result.clickLogs, show: scope === 'ALL' || scope === 'CLICK_LOGS' },
                  ].filter((r) => r.show).map((r) => (
                    <li key={r.label} className="flex justify-between px-3 py-2"><span className="text-gray-600">{r.label}</span><span className="font-semibold tabular-nums text-gray-900">{r.n.toLocaleString()} removed</span></li>
                  ))}
                </ul>
                <div className="flex justify-end"><button type="button" onClick={close} className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-800">Done</button></div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

