'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PackageScope, SellerPackage, SellerSubscription } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { usePricingCurrency } from '@/hooks/usePricingCurrency';

function daysLeft(endDate: string): number {
  const diff = new Date(endDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

interface SubscriptionClientPageProps {
  defaultScope?: PackageScope;
}

export default function SubscriptionClientPage({ defaultScope }: SubscriptionClientPageProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pricing = usePricingCurrency();
  const scopeValue = searchParams ? searchParams.get('scope') : null;
  const scope: PackageScope = scopeValue === 'CV' ? 'CV' : defaultScope ?? 'LISTING';
  const isCvScope = scope === 'CV';

  const [subscription, setSubscription] = useState<SellerSubscription | null>(null);
  const [packages, setPackages] = useState<SellerPackage[]>([]);
  const [fetching, setFetching] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState('');
  const [selectedPkg, setSelectedPkg] = useState<SellerPackage | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchData = useCallback(async () => {
    setFetching(true);
    try {
      const [subRes, pkgRes] = await Promise.all([
        api.get(`/packages/my-subscription?scope=${scope}`),
        api.get(`/packages?scope=${scope}`),
      ]);
      setSubscription(subRes.data.subscription);
      setPackages(pkgRes.data.packages ?? []);
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
    if (!pkg.isFree && !paymentRef.trim()) {
      setError('Please enter a payment reference for paid packages.');
      return;
    }

    setSubscribing(pkg.id);
    setError('');
    setSuccess('');
    try {
      const res = await api.post(`/packages/${pkg.id}/subscribe`, {
        paymentRef: pkg.isFree ? undefined : paymentRef.trim() || undefined,
      });
      setSelectedPkg(null);
      setPaymentRef('');
      await fetchData();

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

  if (loading || fetching) return <div className="p-8 text-center text-sm text-gray-500">Loading…</div>;

  const remaining = subscription ? daysLeft(subscription.endDate) : 0;

  function tierLabel(pkg: SellerPackage): string {
    if (pkg.isFree) return '7-Day Free Trial';
    if (pkg.durationDays <= 35) return '1 Month';
    if (pkg.durationDays >= 360) return '1 Year';
    return `${pkg.durationDays} Days`;
  }

  function subscribeBtnLabel(pkg: SellerPackage): string {
    if (pkg.isFree) return 'Start Free Trial';
    const t = tierLabel(pkg);
    if (t === '1 Month' || t === '1 Year') return `Get ${t}`;
    return 'Select Plan';
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

      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-premium-navy via-sky-600 to-sky-400 px-5 py-6 text-white shadow-xl sm:px-7 mb-6 animate-fade-in">
        <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/85">
          {isCvScope ? 'CV Package' : 'Listing Package'}
        </p>
        <h1 className="mt-3 text-2xl font-black tracking-tight">{isCvScope ? 'My CV Subscription' : 'My Subscription'}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/85">
          {isCvScope
            ? 'A paid CV package unlocks autonomous digital CV services. Choose monthly or yearly access.'
            : 'A valid package is required to post listings. Start free for 7 days, then choose a 1-month or 1-year plan.'}
        </p>
        {subscription?.status === 'ACTIVE' ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-white/80 max-w-2xl">
              Your subscription is active. {isCvScope ? 'Launch the CV toolset and manage your digital CVs now.' : 'Continue posting ads and managing your marketplace presence.'}
            </p>
            <a
              href={isCvScope ? '/cv-generator' : '/listings/create'}
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
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

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Current Plan</h2>

        {subscription ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-gray-900">{subscription.package.name}</span>
                {subscription.package.isFree && (
                  <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                    FREE TRIAL
                  </span>
                )}
                <span className={`text-[10px] font-bold border px-2 py-0.5 rounded-full ${
                  subscription.status === 'ACTIVE'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-red-50 text-red-700 border-red-200'
                }`}>
                  {subscription.status}
                </span>
              </div>
              {subscription.package.description && (
                <p className="mt-1 text-sm text-gray-500">{subscription.package.description}</p>
              )}
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">Started</p>
                  <p className="text-xs font-bold text-gray-700 mt-0.5">{formatDate(subscription.startDate)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">Expires</p>
                  <p className={`text-xs font-bold mt-0.5 ${remaining <= 3 ? 'text-red-600' : 'text-gray-700'}`}>
                    {formatDate(subscription.endDate)}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">Days Left</p>
                  <p className={`text-xs font-bold mt-0.5 ${remaining <= 3 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {remaining}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">{isCvScope ? 'Access' : 'Max Listings'}</p>
                  <p className="text-xs font-bold text-gray-700 mt-0.5">
                    {isCvScope ? 'All CV tools' : (subscription.package.maxListings != null ? subscription.package.maxListings : '∞')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">No active subscription</p>
              <p className="text-xs text-amber-600 mt-0.5">
                {isCvScope
                  ? 'You need an active CV package to use autonomous CV services. Choose a plan below.'
                  : 'You need an active package to post listings. Choose a plan below.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-0.5">Choose a Plan</h2>
        <p className="text-xs text-gray-500 mb-4">
          {isCvScope ? 'Choose a monthly or annual CV plan for full autonomous digital access.' : 'Start free for 7 days, then upgrade to a monthly or annual plan.'}
          {!pricing.loading && pricing.currency !== 'USD' && ` (Prices in ${pricing.currency})`}
          {pricing.loading && ' (loading prices...)'}
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {packages.map((pkg) => {
              const isCurrentPkg = subscription?.packageId === pkg.id && subscription?.status === 'ACTIVE';
              const tier = tierLabel(pkg);
              return (
                <div
                  key={pkg.id}
                  className={`rounded-2xl border p-4 transition-all flex flex-col ${
                    isCurrentPkg
                      ? 'border-sky-400 bg-sky-50 shadow-sm'
                      : pkg.isFree
                      ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                      : 'border-gray-200 bg-white hover:border-sky-200 hover:shadow-sm'
                  }`}
                >
                  <div className="mb-2">
                    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      pkg.isFree
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : tier === '1 Year'
                        ? 'bg-violet-100 text-violet-700 border-violet-200'
                        : 'bg-sky-100 text-sky-700 border-sky-200'
                    }`}>
                      {tier}
                    </span>
                    {isCurrentPkg && (
                      <span className="ml-1.5 text-[10px] font-bold bg-sky-100 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full">
                        CURRENT
                      </span>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-bold text-gray-900 text-sm leading-snug">{pkg.name}</span>
                    <span className="text-base font-black text-gray-900 shrink-0">
                      {pkg.isFree
                        ? 'Free'
                        : pkg.currency === 'USD'
                        ? pricing.loading
                          ? `$${pkg.price}`
                          : pricing.format(pkg.price)
                        : `${pkg.price.toLocaleString('en-US')} ${pkg.currency}`}
                    </span>
                  </div>

                  {pkg.description && (
                    <p className="text-xs text-gray-500 mb-2 flex-1">{pkg.description}</p>
                  )}

                  <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-3">
                    <span className="flex items-center gap-0.5">📅 {pkg.durationDays} day{pkg.durationDays !== 1 ? 's' : ''}</span>
                    <span className="flex items-center gap-0.5">
                      📋 {isCvScope ? 'All CV tools' : (pkg.maxListings != null ? `${pkg.maxListings} listings` : 'Unlimited')}
                    </span>
                  </div>

                  {!pkg.isFree && selectedPkg?.id === pkg.id && (
                    <div className="mb-3">
                      <input
                        type="text"
                        value={paymentRef}
                        onChange={(e) => setPaymentRef(e.target.value)}
                        placeholder="Payment reference / transaction ID"
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                      />
                    </div>
                  )}

                  {isCurrentPkg ? (
                    <div className="flex items-center gap-1 text-sky-600 text-xs font-semibold mt-auto">
                      <span>✓</span> Active plan
                    </div>
                  ) : subscription?.status === 'ACTIVE' ? (
                    <p className="text-xs text-gray-400 mt-auto">Cancel current plan to switch.</p>
                  ) : (
                    <button
                      disabled={subscribing === pkg.id}
                      onClick={() => {
                        if (!pkg.isFree && selectedPkg?.id !== pkg.id) {
                          setSelectedPkg(pkg);
                          setPaymentRef('');
                          return;
                        }
                        handleSubscribe(pkg);
                      }}
                      className={`mt-auto w-full py-2 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-50 ${
                        pkg.isFree
                          ? 'bg-emerald-500 hover:bg-emerald-600'
                          : 'bg-sky-600 hover:bg-sky-700'
                      }`}
                    >
                      {subscribing === pkg.id
                        ? 'Processing…'
                        : selectedPkg?.id === pkg.id
                        ? 'Confirm & Subscribe'
                        : subscribeBtnLabel(pkg)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
