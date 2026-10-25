'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PackageScope, SellerPackage, UpgradeMode } from '@/lib/types';
import { MomoPayModal } from '@/components/payments/MomoPayModal';
import { useMomoConfig } from '@/lib/momo';
import { formatDuration, formatAllowance, formatPackagePrice, planLabel, isUpgrade } from '@/lib/subscriptionPlans';
import { formatDate } from '@/lib/utils';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { usePricingCurrency } from '@/hooks/usePricingCurrency';
import { useSubscriptionOverview } from '@/lib/subscriptionStatus';
import { SubscriptionStatusCard, StatusBadge } from '@/components/account/SubscriptionStatusCard';
import { effectiveRentalState, daysBetween } from '@/lib/subscriptionStatus';

interface SubscriptionClientPageProps {
  defaultScope?: PackageScope;
}

export default function SubscriptionClientPage({ defaultScope }: SubscriptionClientPageProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pricing = usePricingCurrency();
  const scopeValue = searchParams ? searchParams.get('scope') : null;
  const scope: Exclude<PackageScope, 'STORE'> = scopeValue === 'CV' ? 'CV' : (defaultScope && defaultScope !== 'STORE' ? defaultScope : 'LISTING');
  const isCvScope = scope === 'CV';

  const overview = useSubscriptionOverview(scope, !!user);
  const subscription = overview.current;
  const [rental, setRental] = useState<{ status: string; endDate: string; tier?: string } | null>(null);
  const [packages, setPackages] = useState<SellerPackage[]>([]);
  const [fetching, setFetching] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [upgradePkg, setUpgradePkg] = useState<SellerPackage | null>(null);
  const [upgradeMode, setUpgradeMode] = useState<UpgradeMode>('AFTER_EXPIRY');
  // MTN MoMo: when enabled, paid listing plans are bought through the payment window instead of a typed reference.
  const momo = useMomoConfig();
  const [momoPkg, setMomoPkg] = useState<SellerPackage | null>(null);
  const [momoUpgrade, setMomoUpgrade] = useState<{ pkg: SellerPackage; mode: UpgradeMode } | null>(null);
  const momoPaidRef = useRef(false);

  const fetchData = useCallback(async () => {
    setFetching(true);
    try {
      const [pkgRes, rentalRes] = await Promise.all([
        api.get(`/packages?scope=${scope}`),
        scope === 'LISTING' ? api.get('/store-rentals/my').catch(() => ({ data: { rental: null } })) : Promise.resolve({ data: { rental: null } }),
      ]);
      setPackages(pkgRes.data.packages ?? []);
      setRental(rentalRes.data.rental ?? null);
    } catch {
      // ignore
    } finally {
      setFetching(false);
    }
  }, [scope]);

  useEffect(() => {
    if (!loading && !user) {
      const returnTo = `/profile/subscription${scope === 'CV' ? '?scope=CV' : ''}`;
      router.push(`/auth/login?redirect=${encodeURIComponent(returnTo)}`);
    }
  }, [user, loading, router, scope]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  const handleSubscribe = async (pkg: SellerPackage) => {
    if (!pkg.isFree) return; // paid plans are bought with MTN Mobile Money only
    setSubscribing(pkg.id);
    setError('');
    setSuccess('');
    try {
      const res = await api.post(`/packages/${pkg.id}/subscribe`, {});
      await Promise.all([fetchData(), overview.refresh()]);

      const status = res.data.subscription?.status;
      if (status === 'ACTIVE') {
        setSuccess(`Successfully enrolled in "${pkg.name}"! Redirecting you now…`);
        setTimeout(() => router.push(isCvScope ? '/cv-generator' : '/listings/create'), 1500);
      } else {
        setSuccess(`Your subscription request for "${pkg.name}" has been submitted and is awaiting admin approval. You will be notified once approved.`);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to subscribe. Please try again.');
    } finally {
      setSubscribing(null);
    }
  };

  const openUpgrade = (pkg: SellerPackage) => {
    setUpgradePkg(pkg);
    setUpgradeMode('AFTER_EXPIRY');
    setError('');
    setSuccess('');
  };


  if (loading || fetching || overview.loading) return <div className="p-8 text-center text-sm text-gray-500">Loading…</div>;

  const trialPkg = packages.find((p) => p.isFree);
  const paidPkgs = packages.filter((p) => !p.isFree);
  const currentEnd = subscription ? formatDate(subscription.endDate) : '';
  const blocked = !!overview.pending || !!overview.scheduled;

  function subscribeBtnLabel(pkg: SellerPackage): string {
    return pkg.isFree ? `Start ${formatDuration(pkg.durationDays)} free` : `Get ${formatDuration(pkg.durationDays)}`;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'My Profile', href: '/profile' },
          { label: isCvScope ? 'CV Subscription' : 'Subscription' },
        ]}
      />

      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-premium-navy via-red-600 to-red-400 px-5 py-6 text-white shadow-xl sm:px-7 mb-6 animate-fade-in">
        <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/85">
          {isCvScope ? 'CV Package' : 'Listing Package'}
        </p>
        <h1 className="mt-3 text-2xl font-black tracking-tight">{isCvScope ? 'My CV Subscription' : 'My Subscription'}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/85">
          {isCvScope
            ? `A paid CV package unlocks autonomous digital CV services.${paidPkgs.length ? ` Choose from ${paidPkgs.map((p) => formatDuration(p.durationDays)).join(', ')} access.` : ''}`
            : `A valid package is required to post listings.${trialPkg ? ` Start free for ${formatDuration(trialPkg.durationDays)}` : ''}${paidPkgs.length ? `${trialPkg ? ', then choose ' : ' Choose '}${paidPkgs.map((p) => formatDuration(p.durationDays)).join(', ')}.` : trialPkg ? '.' : ''}`}
        </p>
        {subscription?.status === 'ACTIVE' ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-white/80 max-w-2xl">
              Your subscription is active. {isCvScope ? 'Launch the CV toolset and manage your digital CVs now.' : 'Continue posting ads and managing your marketplace presence.'}
            </p>
            <a
              href={isCvScope ? '/cv-generator' : '/listings/create'}
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
            >
              {isCvScope ? 'Open CV Tools' : 'Create a Listing'}
            </a>
          </div>
        ) : (
          <div className="mt-4 text-sm text-white/75">
            {isCvScope
              ? 'Select a plan below to access premium CV services and publish your professional documents.'
              : 'Select a package below to begin posting listings on Piitrade.'}
          </div>
        )}
      </section>

      <SubscriptionStatusCard overview={overview} scope={scope} openRenew={searchParams?.get('renew') === '1'} onChanged={fetchData} />

      {rental && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
          <span className="text-xl">🏪</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900">Web Store subscription</p>
            <p className="text-xs text-gray-500">
              {effectiveRentalState(rental) === 'ACTIVE'
                ? `Runs until ${formatDate(rental.endDate)} · ${daysBetween(rental.endDate)} days left`
                : effectiveRentalState(rental) === 'PENDING'
                ? 'Awaiting admin approval'
                : `Ended ${formatDate(rental.endDate)}`}
            </p>
          </div>
          <StatusBadge state={effectiveRentalState(rental)} />
          <Link href="/dashboard/store-rental" className="rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700">
            {effectiveRentalState(rental) === 'EXPIRED' ? 'Renew store' : 'Manage store'}
          </Link>
        </div>
      )}

      <div id="plans" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-0.5">Choose a Plan</h2>
        <p className="text-xs text-gray-500 mb-4">
          {isCvScope ? 'Choose a CV plan for full autonomous digital access.' : 'Pick the plan that fits. You can upgrade to a longer or bigger plan at any time.'}
          {pricing.loading && ' (loading prices…)'}
        </p>

        {success && (
          <div className={`mb-4 p-3 rounded-xl text-sm border ${success.includes('awaiting admin approval') ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            {success.includes('awaiting admin approval') && (
              <div className="flex items-start gap-2 mb-1">
                <span className="text-lg">⏳</span>
                <span className="font-semibold">Awaiting Admin Approval</span>
              </div>
            )}
            {success}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {packages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No packages available at this time.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {packages.map((pkg) => {
              const isCurrentPkg = subscription?.packageId === pkg.id && subscription?.status === 'ACTIVE';
              const tier = planLabel(pkg);
              const longest = paidPkgs.length > 0 && pkg.durationDays === Math.max(...paidPkgs.map((p) => p.durationDays));
              const canUpgrade = !!subscription && !isCurrentPkg && !blocked && isUpgrade(
                subscription.terms ?? { durationDays: subscription.package.durationDays, maxListings: subscription.package.maxListings ?? null, price: subscription.package.price },
                { durationDays: pkg.durationDays, maxListings: pkg.maxListings ?? null, price: pkg.price, isFree: pkg.isFree },
              );
              return (
                <div
                  key={pkg.id}
                  className={`rounded-2xl border p-4 transition-all flex flex-col ${
                    isCurrentPkg
                      ? 'border-red-400 bg-red-50 shadow-sm'
                      : pkg.isFree
                      ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                      : 'border-gray-200 bg-white hover:border-red-200 hover:shadow-sm'
                  }`}
                >
                  <div className="mb-2">
                    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      pkg.isFree
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : longest
                        ? 'bg-violet-100 text-violet-700 border-violet-200'
                        : 'bg-red-100 text-red-700 border-red-200'
                    }`}>
                      {tier}
                    </span>
                    {isCurrentPkg && (
                      <span className="ml-1.5 text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">
                        CURRENT
                      </span>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-bold text-gray-900 text-sm leading-snug">{pkg.name}</span>
                    <span className="text-base font-black text-gray-900 shrink-0">
                      {pkg.isFree ? 'Free' : formatPackagePrice(pkg.price, pkg.currency as string, pricing.convert)}
                    </span>
                  </div>

                  {pkg.description && (
                    <p className="text-xs text-gray-500 mb-2 flex-1">{pkg.description}</p>
                  )}

                  <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-3">
                    <span className="flex items-center gap-0.5">📅 {formatDuration(pkg.durationDays)}</span>
                    <span className="flex items-center gap-0.5">📋 {formatAllowance(pkg.maxListings, scope)}</span>
                  </div>

                  {isCurrentPkg ? (
                    <div className="flex items-center gap-1 text-red-600 text-xs font-semibold mt-auto">
                      <span>✓</span> Active plan
                    </div>
                  ) : overview.pending ? (
                    <p className="text-xs text-amber-600 mt-auto">⏳ A request is awaiting payment confirmation.</p>
                  ) : overview.scheduled ? (
                    <p className="text-xs text-violet-600 mt-auto">⏭ An upgrade is already scheduled.</p>
                  ) : canUpgrade ? (
                    <button
                      type="button"
                      onClick={() => openUpgrade(pkg)}
                      className="mt-auto w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors"
                    >
                      Upgrade to {formatDuration(pkg.durationDays)}
                    </button>
                  ) : subscription?.status === 'ACTIVE' ? (
                    <p className="text-xs text-gray-400 mt-auto">Not an upgrade of your current plan.</p>
                  ) : (
                    <button
                      disabled={subscribing === pkg.id}
                      onClick={() => {
                        setError('');
                        setSuccess('');
                        if (!pkg.isFree) {
                          if (!momo.enabled || isCvScope) {
                            setError(isCvScope
                              ? 'CV tools are paid per download with MTN Mobile Money — open the CV generator to pay.'
                              : 'MTN Mobile Money payments are not available right now. Please try again later.');
                            return;
                          }
                          momoPaidRef.current = false;
                          setMomoPkg(pkg);
                          return;
                        }
                        handleSubscribe(pkg);
                      }}
                      className={`mt-auto w-full py-2 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-50 ${
                        pkg.isFree
                          ? 'bg-emerald-500 hover:bg-emerald-600'
                          : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {subscribing === pkg.id
                        ? 'Processing…'
                        : !pkg.isFree && !momo.loading && momo.enabled && !isCvScope
                        ? `Pay with MTN MoMo`
                        : subscribeBtnLabel(pkg)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {upgradePkg && subscription && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Upgrade plan" onClick={() => setUpgradePkg(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-extrabold text-gray-900">Upgrade to {upgradePkg.name}</h3>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ['Price', formatPackagePrice(upgradePkg.price, upgradePkg.currency as string, pricing.convert)],
                ['Duration', formatDuration(upgradePkg.durationDays)],
                ['Allowance', formatAllowance(upgradePkg.maxListings, scope)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-gray-50 px-2 py-2">
                  <dt className="text-[10px] font-semibold uppercase text-gray-400">{k}</dt>
                  <dd className="mt-0.5 text-xs font-bold text-gray-800">{v}</dd>
                </div>
              ))}
            </dl>

            <fieldset className="mt-4 space-y-2">
              <legend className="mb-1 text-xs font-bold text-gray-700">When should it start?</legend>
              {([
                ['AFTER_EXPIRY', `After my current plan ends (${currentEnd})`, 'Nothing is lost: your current plan runs to its end, then the upgrade begins automatically.'],
                ['IMMEDIATE', 'Switch now', 'Your current plan is cancelled once an admin confirms payment and the upgrade starts immediately. Unused days are not carried over.'],
              ] as [UpgradeMode, string, string][]).map(([mode, title, help]) => (
                <label key={mode} className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 ${upgradeMode === mode ? 'border-violet-400 bg-violet-50' : 'border-gray-200 hover:border-violet-200'}`}>
                  <input type="radio" name="upgrade-mode" className="mt-0.5 accent-violet-600" checked={upgradeMode === mode} onChange={() => setUpgradeMode(mode)} />
                  <span><span className="block text-sm font-semibold text-gray-900">{title}</span><span className="block text-xs text-gray-500">{help}</span></span>
                </label>
              ))}
            </fieldset>

            {momo.enabled && !isCvScope ? (
              <button
                type="button"
                onClick={() => { momoPaidRef.current = false; setMomoUpgrade({ pkg: upgradePkg, mode: upgradeMode }); setUpgradePkg(null); }}
                className="mt-4 w-full rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700"
              >
                Pay {formatPackagePrice(upgradePkg.price, upgradePkg.currency as string, pricing.convert)} with MTN MoMo
              </button>
            ) : (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                MTN Mobile Money payments are not available right now. Please try again later.
              </p>
            )}
            <p className="mt-1 text-[11px] text-gray-400">Your current plan is not changed until your payment is confirmed.</p>

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setUpgradePkg(null)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {momoPkg && (
        <MomoPayModal
          title={`${momoPkg.name} · ${formatDuration(momoPkg.durationDays)}`}
          amountLabel={formatPackagePrice(momoPkg.price, momoPkg.currency as string, pricing.convert)}
          defaultPhone={user?.phone}
          reloadAfterPayment={false} // it sends the payer on to "post a listing" itself
          buildRequest={async () => ({ purpose: 'SUBSCRIPTION', packageId: momoPkg.id })}
          onCompleted={() => {
            momoPaidRef.current = true;
            setSuccess(`Payment received — your "${momoPkg.name}" subscription is now active.`);
          }}
          onClose={() => {
            const paid = momoPaidRef.current;
            setMomoPkg(null);
            fetchData();
            overview.refresh();
            if (paid) setTimeout(() => router.push('/listings/create'), 1500);
          }}
        />
      )}

      {momoUpgrade && (
        <MomoPayModal
          title={`Upgrade to ${momoUpgrade.pkg.name}`}
          amountLabel={formatPackagePrice(momoUpgrade.pkg.price, momoUpgrade.pkg.currency as string, pricing.convert)}
          defaultPhone={user?.phone}
          buildRequest={async () => ({ purpose: 'SUBSCRIPTION_UPGRADE', packageId: momoUpgrade.pkg.id, upgradeMode: momoUpgrade.mode })}
          onCompleted={() => {
            momoPaidRef.current = true;
            setSuccess(`Payment received — your upgrade to "${momoUpgrade.pkg.name}" is confirmed.${momoUpgrade.mode === 'AFTER_EXPIRY' ? ' It starts when your current plan ends.' : ''}`);
          }}
          onClose={() => {
            setMomoUpgrade(null);
            fetchData();
            overview.refresh();
          }}
        />
      )}
    </div>
  );
}
