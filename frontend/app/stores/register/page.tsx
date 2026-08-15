'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

const PLANS = [
  {
    id: 'FREE_TRIAL',
    label: 'Free Trial',
    fee: 0,
    feeLabel: 'Free',
    duration: '3 days',
    maxListings: 10,
    description: 'Try the platform with 10 listings for 3 days',
    highlight: false,
  },
  {
    id: 'MONTHLY',
    label: 'Monthly Plan',
    fee: 60,
    feeLabel: '60 AED / mo',
    duration: '1 month',
    maxListings: 100,
    description: 'Post up to 100 listings for 30 days',
    highlight: true,
  },
  {
    id: 'ANNUAL',
    label: 'Annual Plan',
    fee: 300,
    feeLabel: '300 AED / yr',
    duration: '12 months',
    maxListings: 500,
    description: 'Full year access with up to 500 listings',
    highlight: false,
  },
] as const;

type PlanId = (typeof PLANS)[number]['id'];

const SECTION_OPTIONS = [
  { value: 'CLASSIFIEDS', label: 'Classifieds' },
  { value: 'MOTORS', label: 'Motors' },
  { value: 'PROPERTY', label: 'Property' },
  { value: 'ELECTRONICS', label: 'Electronics' },
  { value: 'FASHION', label: 'Fashion' },
  { value: 'FURNITURE', label: 'Furniture' },
  { value: 'JOBS', label: 'Jobs' },
  { value: 'SERVICES', label: 'Services' },
];

export default function StoreRegisterPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [selectedPlan, setSelectedPlan] = useState<PlanId>('MONTHLY');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [entityType, setEntityType] = useState('USER');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [existingRental, setExistingRental] = useState<{ status: string; endDate: string } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/register?next=/stores/register');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    api.get('/store-rentals/my')
      .then(({ data }) => {
        if (data?.rental) setExistingRental(data.rental);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [user]);

  const toggleSection = (val: string) => {
    setSelectedSections((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val]
    );
  };

  const handleSubmit = async () => {
    if (selectedSections.length === 0) {
      setError('Please select at least one posting section.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/store-rentals', {
        plan: selectedPlan,
        entityType,
        placements: { categories: selectedSections, subscriptionPlan: selectedPlan, paymentStatus: 'PENDING' },
      });
      setSuccess('Store registered successfully! Redirecting to your dashboard…');
      setTimeout(() => router.push('/dashboard/store-rental'), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || checking) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  }

  if (existingRental) {
    const isActive = existingRental.status === 'ACTIVE';
    return (
      <div className="min-h-screen bg-gray-50/90 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-3">{isActive ? '🏪' : '⏳'}</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {isActive ? 'You already have an active store' : 'Application pending'}
          </h2>
          <p className="text-gray-500 text-sm mb-6">
            {isActive
              ? `Your store is active until ${new Date(existingRental.endDate).toLocaleDateString('en-US')}.`
              : 'Your store application is being reviewed.'}
          </p>
          <Link
            href="/dashboard/store-rental"
            className="inline-block bg-sky-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-sky-700 transition-colors"
          >
            Go to Store Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-sky-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-violet-100 text-violet-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-3">
            🏪 Seller Registration
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Sell on Piitrade</h1>
          <p className="text-gray-500 text-sm max-w-lg mx-auto">
            Register your store for exclusive posting rights across platform sections.
            Choose your plan and the sections you want to post in.
          </p>
        </div>

        {/* Flash Deals notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 flex items-start gap-2 text-sm text-amber-800">
          <span className="text-lg shrink-0">⚡</span>
          <span>
            <strong>Flash Deals</strong> are exclusive to admins only. Your store plan gives posting rights to the sections you select below.
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 mb-5 text-sm">
            {success}
          </div>
        )}

        {/* Plan selection */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">1. Choose Your Plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PLANS.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlan(plan.id)}
                className={`relative text-left rounded-xl border-2 p-4 transition-all ${
                  selectedPlan === plan.id
                    ? 'border-violet-500 bg-violet-50'
                    : 'border-gray-200 hover:border-violet-200'
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-2.5 right-3 bg-violet-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    POPULAR
                  </span>
                )}
                <p className="font-bold text-gray-900 text-sm">{plan.label}</p>
                <p className="text-violet-600 font-semibold text-lg mt-0.5">{plan.feeLabel}</p>
                <p className="text-gray-500 text-xs mt-1">{plan.description}</p>
                <p className="text-gray-400 text-xs mt-0.5">Duration: {plan.duration}</p>
                <p className="text-gray-400 text-xs">Max listings: {plan.maxListings}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Entity type */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">2. Account Type</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {['USER', 'AGENT', 'COMPANY', 'ORGANIZATION'].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setEntityType(type)}
                className={`rounded-xl border-2 py-2.5 text-sm font-medium transition-all ${
                  entityType === type
                    ? 'border-sky-500 bg-sky-50 text-sky-700'
                    : 'border-gray-200 text-gray-600 hover:border-sky-200'
                }`}
              >
                {type === 'USER' ? 'Individual' : type.charAt(0) + type.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Section selection */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">3. Posting Sections</h2>
          <p className="text-xs text-gray-500 mb-4">Select the site sections where your store will have posting rights.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SECTION_OPTIONS.map((sec) => (
              <button
                key={sec.value}
                type="button"
                onClick={() => toggleSection(sec.value)}
                className={`rounded-xl border-2 py-2.5 text-sm font-medium transition-all ${
                  selectedSections.includes(sec.value)
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 text-gray-600 hover:border-emerald-200'
                }`}
              >
                {sec.label}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !!success}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-700 text-white font-bold text-sm hover:from-violet-700 hover:to-purple-800 transition-all disabled:opacity-60 shadow-lg"
        >
          {submitting ? 'Registering Store…' : 'Register My Store'}
        </button>
        <p className="text-center text-xs text-gray-400 mt-3">
          Already have a store?{' '}
          <Link href="/dashboard/store-rental" className="text-violet-600 hover:underline">
            Go to your dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
