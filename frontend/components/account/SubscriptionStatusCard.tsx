'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { formatDuration, formatPackagePrice, formatAllowance } from '@/lib/subscriptionPlans';
import type { PackageScope } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { MomoPayModal } from '@/components/payments/MomoPayModal';
import { useMomoConfig, type MomoInitiateRequest } from '@/lib/momo';
import {
  STATE_META,
  daysBetween,
  effectiveRentalState,
  type AccessState,
  type SubscriptionOverview,
} from '@/lib/subscriptionStatus';

export function StatusBadge({ state, className = '' }: { state: AccessState; className?: string }) {
  const m = STATE_META[state];
  const live = state === 'ACTIVE' || state === 'PENDING';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${m.badge} ${className}`}>
      <span className="relative flex h-2 w-2">
        {live && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${m.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${m.dot}`} />
      </span>
      {m.label}
    </span>
  );
}

function errMsg(e: unknown, fallback: string) {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;
}

interface Props {
  overview: SubscriptionOverview;
  scope: Exclude<PackageScope, 'STORE'>;
  /** Auto-open the renewal form (used by /profile/subscription?renew=1). */
  openRenew?: boolean;
  onChanged?: () => void;
}

/** Full status panel: badge, term dates, countdown, and Renew / Choose-a-plan actions. */
export function SubscriptionStatusCard({ overview, scope, openRenew = false, onChanged }: Props) {
  const { state, shown, lastTerm, pending, scheduled } = overview;
  const [renewOpen, setRenewOpen] = useState(openRenew);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // MTN MoMo: when enabled, listing plans are paid through the payment window instead of a typed reference.
  const { user } = useAuth();
  const momo = useMomoConfig();
  const momoOn = momo.enabled && scope === 'LISTING';
  const [momoJob, setMomoJob] = useState<{ title: string; price: number; currency: string; request: MomoInitiateRequest } | null>(null);
  const openMomo = (job: { title: string; price: number; currency: string; request: MomoInitiateRequest }) => {
    setMsg(null);
    setMomoJob(job);
  };

  const pkg = shown?.package;
  const base = overview.current ?? lastTerm;
  const canRenew = !!base && !base.package.isFree && state !== 'PENDING' && state !== 'CANCELLED' && (state === 'EXPIRED' || (state === 'ACTIVE' && daysBetween(base.endDate) <= 7));
  const remaining = state === 'ACTIVE' && shown ? daysBetween(shown.endDate) : 0;
  const total = shown ? Math.max(1, Math.round((+new Date(shown.endDate) - +new Date(shown.startDate)) / 86_400_000)) : 1;
  const pct = state === 'ACTIVE' ? Math.min(100, Math.round((remaining / total) * 100)) : 0;
  const urgent = state === 'ACTIVE' && remaining <= 3;

  const cancelSub = async (id: string, doneText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/packages/subscriptions/${id}/cancel`);
      setMsg({ ok: true, text: doneText });
      await overview.refresh();
      onChanged?.();
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e, 'Could not cancel. Please try again.') });
    } finally {
      setBusy(false);
    }
  };

  const frame =
    state === 'EXPIRED' ? 'border-red-200 bg-red-50/40'
    : state === 'PENDING' ? 'border-amber-200 bg-amber-50/40'
    : state === 'ACTIVE' ? 'border-emerald-200 bg-white'
    : 'border-gray-200 bg-white';

  return (
    <div id="renew" className={`mb-6 rounded-2xl border p-5 shadow-sm transition-colors ${frame} ${state === 'EXPIRED' ? 'animate-ring-red' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-gray-900">{scope === 'CV' ? 'CV subscription' : 'Listing subscription'}</h2>
        <StatusBadge state={state} />
        {pkg?.isFree && state !== 'NONE' && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">FREE TRIAL</span>
        )}
        {state === 'ACTIVE' && remaining <= 7 && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${urgent ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-amber-100 text-amber-800'}`}>
            {remaining} day{remaining === 1 ? '' : 's'} left
          </span>
        )}
      </div>

      {shown ? (
        <>
          <p className="mt-2 text-lg font-bold text-gray-900">{shown.terms?.packageName ?? pkg?.name}</p>
          {pkg?.description && <p className="text-sm text-gray-500">{pkg.description}</p>}

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={state === 'PENDING' ? 'Starts' : 'Started'} value={formatDate(shown.startDate)} />
            <Stat label={state === 'EXPIRED' ? 'Expired on' : 'Expires'} value={formatDate(shown.endDate)} tone={state === 'EXPIRED' ? 'bad' : urgent ? 'bad' : undefined} />
            <Stat label="Days left" value={state === 'ACTIVE' ? String(remaining) : '—'} tone={state === 'ACTIVE' ? (urgent ? 'bad' : 'good') : undefined} />
            <Stat label={scope === 'CV' ? 'Access' : 'Max listings'} value={scope === 'CV' ? 'All CV tools' : (shown.terms ? shown.terms.maxListings : pkg?.maxListings) != null ? String(shown.terms ? shown.terms.maxListings : pkg?.maxListings) : '∞'} />
          </div>

          {state === 'ACTIVE' && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
              <div className={`h-full rounded-full transition-all duration-700 ${urgent ? 'bg-red-500' : remaining <= 7 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-600">
          {scope === 'CV'
            ? 'You need an active CV package to use the CV tools. Pick a plan below.'
            : 'You have no subscription yet. Ordinary accounts can post a small number of free listings; pick a plan below for more.'}
        </p>
      )}

      {state === 'EXPIRED' && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          Your plan has expired{scope === 'LISTING' ? ' — posting above the free allowance is paused until you renew.' : ' — renew to keep using the CV tools.'}
        </p>
      )}
      {pending && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">
            ⏳ {pending.changeKind === 'UPGRADE' ? 'Upgrade' : pending.changeKind === 'RENEWAL' ? 'Renewal' : 'Request'} awaiting payment confirmation
            {pending.terms ? ` — ${pending.terms.packageName} · ${formatPackagePrice(pending.terms.price, String(pending.terms.currency))} · ${formatDuration(pending.terms.durationDays)}` : ''}
          </p>
          <p className="mt-0.5 text-amber-800">
            {pending.paymentRef ? `Payment ref ${pending.paymentRef}. ` : ''}We’ll notify you as soon as an admin confirms it.
            {pending.changeKind === 'UPGRADE'
              ? pending.upgradeMode === 'IMMEDIATE'
                ? ' When confirmed it replaces your current plan straight away.'
                : ` When confirmed it starts automatically when your current plan ends${overview.current ? ` on ${formatDate(overview.current.endDate)}` : ''}.`
              : overview.current ? ' Your current term keeps running in the meantime.' : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {momoOn && (() => {
              // Pay at the terms the request was made under (its snapshot), through the matching purpose.
              const price = pending.terms?.price ?? pending.package.price;
              if (!(price > 0)) return null;
              const request: MomoInitiateRequest =
                pending.changeKind === 'UPGRADE'
                  ? { purpose: 'SUBSCRIPTION_UPGRADE', packageId: pending.packageId, upgradeMode: pending.upgradeMode ?? 'AFTER_EXPIRY' }
                  : pending.changeKind === 'RENEWAL'
                    ? { purpose: 'SUBSCRIPTION_RENEWAL', subscriptionId: pending.replacesId ?? base?.id ?? pending.id }
                    : { purpose: 'SUBSCRIPTION', packageId: pending.packageId };
              return (
                <button type="button" disabled={busy}
                  onClick={() => openMomo({ title: pending.terms?.packageName ?? pending.package.name, price, currency: String(pending.terms?.currency ?? pending.package.currency), request })}
                  className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-600 disabled:opacity-50">
                  Pay now with MTN MoMo
                </button>
              );
            })()}
            <button type="button" disabled={busy} onClick={() => cancelSub(pending.id, 'Request cancelled.')}
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
              Cancel this request
            </button>
          </div>
        </div>
      )}
      {scheduled && (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
          <p className="font-semibold">
            ⏭ Next plan: {(scheduled.terms?.packageName ?? scheduled.package.name)} starts {formatDate(scheduled.startDate)}
          </p>
          <p className="mt-0.5 text-violet-800">
            Confirmed and paid. It begins by itself when your current plan ends and runs {formatDuration(scheduled.terms?.durationDays ?? scheduled.package.durationDays)}
            {' '}({formatAllowance(scheduled.terms ? scheduled.terms.maxListings : scheduled.package.maxListings, scope)}).
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {overview.current && (
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm('Start the upgrade now? Your current plan will be cancelled and its remaining days are not carried over.')) cancelSub(overview.current!.id, 'Your upgrade has started.'); }}
                className="rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-violet-700 disabled:opacity-50">
                Start it now (ends current plan)
              </button>
            )}
            <button type="button" disabled={busy}
              onClick={() => { if (window.confirm('Cancel the scheduled upgrade? Your current plan is not affected.')) cancelSub(scheduled.id, 'Scheduled upgrade cancelled.'); }}
              className="rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-[11px] font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50">
              Cancel upgrade
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p role="status" className={`mt-3 rounded-xl border px-3 py-2 text-xs font-medium ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canRenew && !renewOpen && (
          <button type="button" onClick={() => setRenewOpen(true)}
            className={`rounded-xl px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors ${state === 'EXPIRED' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
            {state === 'EXPIRED' ? 'Renew now' : 'Renew early'}
          </button>
        )}
        {(state === 'EXPIRED' || state === 'CANCELLED' || state === 'NONE') && !canRenew && (
          <a href="#plans" className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Choose a plan</a>
        )}
        {state === 'ACTIVE' && !canRenew && (
          <Link href={scope === 'CV' ? '/cv-generator' : '/listings/create'} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">
            {scope === 'CV' ? 'Open CV tools' : 'Post a listing'}
          </Link>
        )}
      </div>

      {canRenew && renewOpen && base && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-600">
            Renew <b>{base.package.name}</b> for {formatDuration(base.package.durationDays)} at {formatPackagePrice(base.package.price, String(base.package.currency))}
            {state === 'ACTIVE' ? ' — the new term starts when your current one ends, so no paid days are lost.' : '.'}
          </p>
          {momoOn && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <button type="button"
                onClick={() => openMomo({ title: `${base.package.name} renewal`, price: base.package.price, currency: String(base.package.currency), request: { purpose: 'SUBSCRIPTION_RENEWAL', subscriptionId: base.id } })}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">
                Pay {formatPackagePrice(base.package.price, String(base.package.currency))} with MTN MoMo
              </button>
              <button type="button" onClick={() => setRenewOpen(false)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Cancel</button>
            </div>
          )}
          {!momoOn && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="flex-1 text-xs text-gray-500">
                {scope === 'CV' ? 'CV tools are paid per download with MTN Mobile Money.' : 'MTN Mobile Money payments are not available right now. Please try again later.'}
              </p>
              <button type="button" onClick={() => setRenewOpen(false)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Close</button>
            </div>
          )}
        </div>
      )}

      {momoJob && (
        <MomoPayModal
          title={momoJob.title}
          amountLabel={formatPackagePrice(momoJob.price, momoJob.currency)}
          defaultPhone={user?.phone}
          buildRequest={async () => momoJob.request}
          onCompleted={() => setMsg({ ok: true, text: 'Payment received — your plan has been updated.' })}
          onClose={() => {
            setMomoJob(null);
            setRenewOpen(false);
            overview.refresh();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase text-gray-400">{label}</p>
      <p className={`mt-0.5 text-xs font-bold ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-gray-700'}`}>{value}</p>
    </div>
  );
}

/** One-line status strip for pages that only need a reminder (e.g. /profile/listings). */
export function SubscriptionStatusStrip({ overview, className = '', children }: { overview: SubscriptionOverview; className?: string; children?: React.ReactNode }) {
  const { state, shown, lastTerm } = overview;
  const remaining = state === 'ACTIVE' && shown ? daysBetween(shown.endDate) : 0;
  const base = overview.current ?? lastTerm;
  const renewable = !!base && !base.package.isFree && (state === 'EXPIRED' || (state === 'ACTIVE' && remaining <= 7));
  const tone =
    state === 'EXPIRED' ? 'border-red-200 bg-red-50 text-red-800'
    : state === 'PENDING' ? 'border-amber-200 bg-amber-50 text-amber-800'
    : state === 'ACTIVE' ? (remaining <= 3 ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')
    : 'border-amber-200 bg-amber-50 text-amber-800';
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-1.5 text-xs ${tone} ${className}`}>
      <StatusBadge state={state} />
      {shown && <span className="font-semibold">{shown.package.name}</span>}
      {state === 'ACTIVE' && shown && <span>{remaining} days left · {formatDate(shown.endDate)}</span>}
      {state === 'EXPIRED' && shown && <span>ended {formatDate(shown.endDate)}</span>}
      {state === 'PENDING' && <span>awaiting payment confirmation</span>}
      {(state === 'NONE' || state === 'CANCELLED') && <span>No active subscription</span>}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {renewable && (
          <Link href="/profile/subscription?renew=1#renew" className={`rounded-md px-2.5 py-1 font-bold text-white ${state === 'EXPIRED' ? 'animate-ring-red bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
            {state === 'EXPIRED' ? 'Renew' : 'Renew early'}
          </Link>
        )}
        <Link href="/profile/subscription" className="font-bold underline underline-offset-2">
          {state === 'NONE' || state === 'CANCELLED' || (state === 'EXPIRED' && !renewable) ? 'Choose a plan' : 'Manage'}
        </Link>
        {children}
      </span>
    </div>
  );
}

/** One-line status strip for a Web Store owner's rental. */
export function RentalStatusStrip({ rental, className = '' }: { rental: { status: string; endDate: string; tier?: string }; className?: string }) {
  const state = effectiveRentalState(rental);
  const left = daysBetween(rental.endDate);
  const tone =
    state === 'EXPIRED' ? 'border-red-200 bg-red-50 text-red-800'
    : state === 'PENDING' ? 'border-amber-200 bg-amber-50 text-amber-800'
    : state === 'ACTIVE' ? (left <= 3 ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')
    : 'border-gray-200 bg-gray-50 text-gray-700';
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-1.5 text-xs ${tone} ${className}`}>
      <span>🏪</span>
      <StatusBadge state={state} />
      <span className="font-semibold">Web Store{rental.tier && rental.tier !== 'FREE' ? ` · ${rental.tier}` : ''}</span>
      {state === 'ACTIVE' && <span>{left} days left · {formatDate(rental.endDate)}</span>}
      {state === 'EXPIRED' && <span>ended {formatDate(rental.endDate)}</span>}
      {state === 'PENDING' && <span>awaiting admin approval</span>}
      <span className="ml-auto flex items-center gap-2">
        {(state === 'EXPIRED' || (state === 'ACTIVE' && left <= 14)) && (
          <Link href="/dashboard/store-rental" className={`rounded-md px-2.5 py-1 font-bold text-white ${state === 'EXPIRED' ? 'animate-ring-red bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
            {state === 'EXPIRED' ? 'Renew' : 'Renew early'}
          </Link>
        )}
        <Link href="/dashboard/store-rental" className="font-bold underline underline-offset-2">Manage store</Link>
      </span>
    </div>
  );
}
