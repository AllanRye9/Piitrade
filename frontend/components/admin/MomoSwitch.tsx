'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/momo';

/**
 * Admin on/off switch for MTN MoMo. Shown on Admin → MoMo Payments and in Admin → Settings, both
 * driven by the same server state (GET/PUT /payments/admin/status|switch), so they can never disagree.
 *
 * Switching OFF stops NEW payments only: customers who already approved a prompt on their phone are
 * still credited. Switching ON is refused by the server (and the switch disabled here) until the
 * MTN credentials are complete, so a half-configured integration can never take real money.
 */
interface MomoAdminStatus {
  enabled: boolean;
  environment: string;
  problems: string[];
  switch: { on: boolean; source: 'admin' | 'env'; canEnable: boolean; configProblems: string[] };
}

export default function MomoSwitch({ onChange, className = '' }: { onChange?: (status: MomoAdminStatus) => void; className?: string }) {
  const [status, setStatus] = useState<MomoAdminStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const { data } = await api.get('/payments/admin/status');
      setStatus(data as MomoAdminStatus);
      onChange?.(data as MomoAdminStatus);
    } catch {
      setStatus(null);
      setLoadFailed(true);
    }
  }, [onChange]);

  useEffect(() => { load(); }, [load]);

  const flip = async (next: boolean) => {
    if (!status || busy) return;
    if (!next && !window.confirm(
      'Switch MoMo off?\n\nCustomers will no longer see or be able to use MTN MoMo, and plans, stores and CV downloads fall back to the manual payment flow.\n\nPayments a customer has already approved on their phone will still be completed automatically.',
    )) return;
    setBusy(true); setError(null);
    try {
      const { data } = await api.put('/payments/admin/switch', { enabled: next });
      setStatus(data as MomoAdminStatus);
      onChange?.(data as MomoAdminStatus);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not change the MoMo switch.'));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loadFailed) {
    return (
      <p role="alert" className={`rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}>
        Couldn&apos;t load the MoMo switch. <button type="button" onClick={load} className="font-semibold underline">Try again</button>
      </p>
    );
  }
  if (!status) return <div className={`h-20 animate-pulse rounded-xl border border-gray-100 bg-gray-50 ${className}`} aria-busy="true" />;

  const on = status.switch.on;
  const live = status.enabled;
  const blocked = !on && !status.switch.canEnable; // wants to turn on, but the credentials are not complete
  const badge = live
    ? { text: `LIVE (${status.environment})`, cls: 'bg-emerald-100 text-emerald-800' }
    : on
      ? { text: 'ON, BUT NOT WORKING', cls: 'bg-amber-100 text-amber-800' }
      : { text: 'OFF', cls: 'bg-gray-200 text-gray-700' };

  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`} aria-labelledby="momo-switch-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="momo-switch-title" className="text-sm font-bold text-gray-900">Accept MTN Mobile Money payments</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.text}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {on
              ? 'Customers can pay with MTN MoMo for plans, listing tiers, stores and CV downloads.'
              : 'MoMo is hidden from customers. Plans, tiers, stores and CV downloads use the manual payment flow.'}
            {' '}Turning it off never cancels a payment a customer has already approved.
          </p>
          {status.switch.source === 'env' && (
            <p className="mt-1 text-[11px] text-gray-400">
              Currently following the <code>MTN_ENABLED</code> server setting. Using this switch overrides it.
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Accept MTN Mobile Money payments"
          disabled={busy || blocked}
          onClick={() => flip(!on)}
          className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-emerald-600' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {blocked && (
        <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">MoMo can&apos;t be switched on yet. Fix these on the backend service, restart it, then come back:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {status.switch.configProblems.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <button type="button" onClick={load} className="mt-2 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold hover:bg-amber-100">Re-check</button>
        </div>
      )}
      {on && !live && status.problems.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">The switch is on, but customers still can&apos;t use MoMo:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{status.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}
