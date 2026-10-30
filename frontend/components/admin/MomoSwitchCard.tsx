'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/momo';

/** What GET /payments/admin/status and PUT /payments/admin/switch return. Problems are variable names only. */
export interface MomoAdminStatus {
  /** MoMo is actually live for customers right now. */
  enabled: boolean;
  /** The ON/OFF switch on its own. */
  switchedOn: boolean;
  /** Who set the switch: an admin (this card), or — until it is first used — the MTN_ENABLED variable. */
  switchSource: 'admin' | 'env';
  environment: string;
  problems: string[];
}

function isStatus(v: unknown): v is MomoAdminStatus {
  const s = v as Partial<MomoAdminStatus> | null;
  return !!s && typeof s.enabled === 'boolean' && typeof s.switchedOn === 'boolean' && Array.isArray(s.problems);
}

/**
 * Admin → MoMo Payments: the master ON/OFF switch for MTN Mobile Money.
 * ON is only possible while the MTN credentials on the server are complete (the server enforces this and
 * lists what is missing); OFF is always possible and asks for one confirmation first.
 */
export function MomoSwitchCard() {
  const [status, setStatus] = useState<MomoAdminStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const { data } = await api.get('/payments/admin/status');
      if (!isStatus(data)) throw new Error('unexpected response');
      setStatus(data);
    } catch {
      setStatus(null);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const change = async (enabled: boolean) => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put('/payments/admin/switch', { enabled });
      if (!isStatus(data)) throw new Error('unexpected response');
      setStatus(data);
      setConfirmOff(false);
    } catch (err) {
      // A refused "turn on" carries the current status (including what is missing) in its body.
      const body = (err as { response?: { data?: unknown } })?.response?.data;
      if (isStatus(body)) setStatus(body);
      setError(apiErrorMessage(err, 'Could not change the MoMo switch. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Couldn&apos;t load the MoMo switch.{' '}
        <button type="button" onClick={() => void load()} className="font-semibold underline">Try again</button>
      </div>
    );
  }
  if (!status) {
    return <div className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-50" aria-busy="true" aria-label="Loading MoMo switch" />;
  }

  const blocked = status.problems.length > 0;
  const live = status.enabled;
  const onButBroken = status.switchedOn && !live;
  const canTurnOn = !blocked;

  const pill = live
    ? { text: 'LIVE', cls: 'bg-emerald-100 text-emerald-800' }
    : onButBroken
      ? { text: 'ON · NOT WORKING', cls: 'bg-amber-100 text-amber-800' }
      : { text: 'OFF', cls: 'bg-gray-200 text-gray-700' };

  return (
    <section aria-label="MTN MoMo payments switch" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-gray-900">MTN MoMo payments</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${pill.cls}`}>{pill.text}</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{status.environment}</span>
          </div>
          <p className="mt-1 text-xs text-gray-600">
            {live
              ? <>Customers can pay with MTN Mobile Money for plans, listing tiers, stores and CV downloads.{status.environment === 'sandbox' ? ' Sandbox: no real money moves.' : ''}</>
              : onButBroken
                ? <>The switch is on, but MoMo can&apos;t run until the problems below are fixed, so customers don&apos;t see it.</>
                : <>MoMo is off. Paid options show as unavailable and customers can&apos;t pay with Mobile Money.</>}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={status.switchedOn}
          aria-label="MTN MoMo payments"
          disabled={saving || (!status.switchedOn && !canTurnOn)}
          title={!status.switchedOn && !canTurnOn ? 'Fix the configuration problems first' : undefined}
          onClick={() => { setError(''); if (status.switchedOn) setConfirmOff(true); else void change(true); }}
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${status.switchedOn ? 'bg-emerald-500' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${status.switchedOn ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {confirmOff && (
        <div role="alertdialog" aria-label="Confirm turning MoMo off" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Turn MTN MoMo off?</p>
          <p className="mt-0.5 text-xs">Customers will stop seeing &ldquo;Pay with MTN MoMo&rdquo; straight away. Payments already in progress are not cancelled, but won&apos;t be settled automatically until MoMo is back on.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={saving} onClick={() => void change(false)} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60">{saving ? 'Turning off…' : 'Turn off MoMo'}</button>
            <button type="button" disabled={saving} onClick={() => setConfirmOff(false)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {blocked && (
        <div role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <p className="font-bold">{status.switchedOn ? 'Fix these to make MoMo work' : 'Before MoMo can be switched on, fix these'}:</p>
          <p className="mt-0.5">On the backend service (Railway → Variables), then restart it.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {status.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <button type="button" onClick={() => void load()} className="mt-2 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold hover:bg-amber-100">Re-check</button>
        </div>
      )}

      <p className="mt-3 text-[11px] text-gray-500">
        {status.switchSource === 'admin'
          ? 'Controlled from this switch. The MTN_ENABLED server variable is no longer used.'
          : 'Not set from here yet, so the MTN_ENABLED server variable is deciding. The first time you use this switch it takes over.'}
      </p>
    </section>
  );
}
