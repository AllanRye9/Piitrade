'use client';

/**
 * Store Rental & Management Dashboard
 *
 * Features:
 * - Apply for a store with a $100 USD subscription fee (converted to country currency)
 * - Payment flow before store activation
 * - Admin approval model (PENDING → ACTIVE)
 * - Store profile editing (logo, banner, name, description, contact details)
 * - Listing management links (add, edit, delete)
 * - Route listings to platform partitions: Latest Collections, Featured Deal, Other Collections
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { resolveImageUrl } from '@/lib/utils';

// ── Subscription fee: $100 USD converted to each country's currency ─────────
// Rates are approximate display values (not live); backend should store in USD and convert as needed.
const SUBSCRIPTION_FEE_USD = 100;
const COUNTRY_CURRENCY_MAP: Record<string, { currency: string; rate: number; symbol: string }> = {
  UAE:    { currency: 'AED', rate: 3.67,  symbol: 'AED' },
  UGANDA: { currency: 'UGX', rate: 3700,  symbol: 'UGX' },
  KENYA:  { currency: 'KES', rate: 130,   symbol: 'KES' },
  CHINA:  { currency: 'CNY', rate: 7.2,   symbol: 'CNY' },
};

function getConvertedFee(country: string): { amount: number; currency: string; symbol: string; display: string } {
  const mapping = COUNTRY_CURRENCY_MAP[country] ?? COUNTRY_CURRENCY_MAP.UAE;
  const amount = Math.round(SUBSCRIPTION_FEE_USD * mapping.rate);
  const display = country === 'UGANDA' || country === 'KENYA'
    ? `${mapping.symbol} ${amount.toLocaleString('en-US')}`
    : `${mapping.symbol} ${amount.toFixed(2)}`;
  return { amount, currency: mapping.currency, symbol: mapping.symbol, display };
}

// ── Types ────────────────────────────────────────────────────────────────────
interface StoreProfile {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  logo: string | null;
  banner: string | null;
  isActive: boolean;
}

interface Rental {
  id: string;
  entityType: string;
  fee: number;
  currency: string;
  startDate: string;
  endDate: string;
  maxListings: number;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  placements: {
    categories?: string[];
    positions?: string[];
    subscriptionPlan?: string;
    paymentStatus?: string;
    renewalDate?: string;
  } | null;
}

type PlacementKey = 'NONE' | 'LATEST_COLLECTIONS' | 'FEATURED_DEAL';
const PLACEMENT_OPTIONS: { value: PlacementKey; label: string; desc: string; color: string }[] = [
  { value: 'NONE',              label: '📦 Other Collections',   desc: 'General listings browseable by all users',           color: 'border-gray-200 bg-gray-50 text-gray-700' },
  { value: 'LATEST_COLLECTIONS', label: '⭐ Latest Collections',  desc: 'Promoted in the Latest Collections homepage section', color: 'border-sky-300 bg-sky-50 text-sky-700' },
  { value: 'FEATURED_DEAL',     label: '🔥 Featured Deal',       desc: 'Pinned as the top Featured Deal on the homepage',     color: 'border-amber-300 bg-amber-50 text-amber-700' },
];

const ENTITY_TYPES = ['AGENT', 'COMPANY', 'ORGANIZATION'];
const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-100 text-amber-700 border border-amber-200',
  ACTIVE:    'bg-green-100 text-green-700 border border-green-200',
  EXPIRED:   'bg-gray-100 text-gray-600 border border-gray-200',
  CANCELLED: 'bg-red-100 text-red-600 border border-red-200',
};

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function daysUntil(d: string): number {
  return Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

// ── Payment Modal ─────────────────────────────────────────────────────────────
function StorePaymentModal({
  fee, onPaid, onClose,
}: { fee: { display: string; amount: number; currency: string }; onPaid: () => void; onClose: () => void }) {
  const [method, setMethod]         = useState<'CARD' | 'MOBILE' | 'BANK'>('CARD');
  const [processing, setProcessing] = useState(false);
  const [error, setError]           = useState('');

  const [cardName, setCardName]     = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc]       = useState('');

  const handlePay = async () => {
    if (method === 'CARD') {
      if (!cardName.trim() || !cardNumber.replace(/\s/g, '').match(/^\d{13,19}$/) ||
          !cardExpiry.match(/^\d{2}\/\d{2}$/) || !cardCvc.match(/^\d{3,4}$/)) {
        setError('Please complete all card details correctly.');
        return;
      }
    }
    setProcessing(true);
    setError('');
    try {
      // Simulate payment confirmation — in production, wire to your payment gateway
      await new Promise(r => setTimeout(r, 1500));
      onPaid();
    } catch {
      setError('Payment failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const fc = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300';

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-sm p-6 sm:p-7"
        onClick={e => e.stopPropagation()}>
        <div className="text-center mb-5">
          <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center mx-auto mb-3 text-3xl">🏪</div>
          <h2 className="text-lg font-bold text-gray-900">Store Subscription Payment</h2>
          <p className="text-2xl font-black text-violet-700 mt-1">{fee.display}</p>
          <p className="text-xs text-gray-400 mt-0.5">≈ $100 USD · Annual store subscription</p>
        </div>

        {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{error}</div>}

        <div className="grid grid-cols-3 gap-2 mb-4">
          {([['CARD', '💳', 'Card'], ['MOBILE', '📱', 'Mobile Pay'], ['BANK', '🏦', 'Bank']] as const).map(([v, icon, label]) => (
            <button key={v} type="button" onClick={() => { setMethod(v); setError(''); }}
              className={`py-2.5 rounded-xl text-xs font-semibold border-2 flex flex-col items-center gap-1 transition-all ${
                method === v ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-600'}`}>
              <span className="text-base">{icon}</span>{label}
            </button>
          ))}
        </div>

        {method === 'CARD' && (
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Cardholder Name</label>
              <input type="text" value={cardName} onChange={e => setCardName(e.target.value)} placeholder="Jane Smith" className={fc}/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Card Number</label>
              <input type="text" value={cardNumber}
                onChange={e => setCardNumber(e.target.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim())}
                placeholder="1234 5678 9012 3456" maxLength={19}
                className={`${fc} font-mono`}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Expiry (MM/YY)</label>
                <input type="text" value={cardExpiry}
                  onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setCardExpiry(v.length > 2 ? v.slice(0, 2) + '/' + v.slice(2) : v); }}
                  placeholder="MM/YY" maxLength={5} className={`${fc} font-mono`}/>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">CVC</label>
                <input type="text" value={cardCvc}
                  onChange={e => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="123" maxLength={4} className={`${fc} font-mono`}/>
              </div>
            </div>
          </div>
        )}

        {method === 'MOBILE' && (
          <div className="mb-4 bg-violet-50 border border-violet-100 rounded-xl p-4 text-sm text-violet-700">
            <p className="font-semibold mb-1">Mobile Money / Wallet</p>
            <p className="text-xs text-violet-600">You will receive a payment prompt on your registered mobile number. Approve it to complete the store subscription.</p>
          </div>
        )}

        {method === 'BANK' && (
          <div className="mb-4 bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1 border border-gray-100">
            <p className="font-semibold text-gray-800 mb-2">Bank Transfer Details</p>
            <p>Bank: <span className="font-medium text-gray-800">Piitrade Business Account</span></p>
            <p>IBAN: <span className="font-mono font-medium text-gray-800">AE07 0331 2345 6789 0123 456</span></p>
            <p>Reference: <span className="font-mono font-bold text-violet-700">STORE-{Date.now().toString().slice(-8)}</span></p>
            <p className="text-gray-400 mt-2">Your store will be activated within 24 hours of payment confirmation.</p>
          </div>
        )}

        <button onClick={handlePay} disabled={processing}
          className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2">
          {processing
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Processing Payment…</>
            : <>Pay {fee.display} → Activate Store</>}
        </button>
        <button onClick={onClose} className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 py-1.5">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Store Profile Editor ───────────────────────────────────────────────────────
function StoreProfileEditor({
  store, onSaved, onCancel,
}: { store: StoreProfile; onSaved: (updated: StoreProfile) => void; onCancel: () => void }) {
  const [name, setName]               = useState(store.name);
  const [description, setDescription] = useState(store.description || '');
  const [logo, setLogo]               = useState(store.logo || '');
  const [banner, setBanner]           = useState(store.banner || '');
  const [logoPreview, setLogoPreview] = useState<string | null>(store.logo ? resolveImageUrl(store.logo) : null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const fc = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white';
  const lc = 'block text-xs font-semibold text-gray-700 mb-1.5';

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);

    // Upload to server
    setUploadingLogo(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('image', file);
      const { data } = await api.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const uploadedUrl = data.url || data.cdnUrl || data.imageUrl || '';
      if (uploadedUrl) {
        setLogo(uploadedUrl);
        setLogoPreview(resolveImageUrl(uploadedUrl));
      } else {
        throw new Error('No URL returned from upload');
      }
    } catch {
      setError('Logo upload failed. Try pasting a URL instead.');
      setLogoPreview(store.logo ? resolveImageUrl(store.logo) : null);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Store name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put('/stores/me', {
        name: name.trim(),
        description: description.trim() || null,
        logo: logo.trim() || null,
        banner: banner.trim() || null,
      });
      onSaved(data.store);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to save store profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">✏️ Edit Store Profile</h2>
          <p className="text-xs text-gray-400 mt-0.5">Update your store details, logo, and description.</p>
        </div>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          Cancel
        </button>
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

      <div className="space-y-4">
        {/* Logo upload */}
        <div>
          <label className={lc}>Store Logo <span className="text-gray-400 font-normal">(recommended: square, min 200×200px)</span></label>
          <div className="flex items-start gap-4">
            {/* Preview */}
            <div className="shrink-0 w-20 h-20 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden relative">
              {logoPreview ? (
                <Image src={logoPreview} alt="Logo preview" fill className="object-contain" sizes="80px" />
              ) : (
                <span className="text-3xl select-none">🏪</span>
              )}
              {uploadingLogo && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-2xl">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            <div className="flex-1 space-y-2">
              {/* File upload button */}
              <label className="block">
                <span className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-50 border border-sky-200 text-sky-700 text-xs font-semibold rounded-lg hover:bg-sky-100 cursor-pointer transition-colors">
                  📁 Upload Logo File
                </span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoFileChange} />
              </label>

              {/* OR: URL input */}
              <div>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">— or paste a URL —</span>
                <input value={logo} onChange={(e) => { setLogo(e.target.value); if (e.target.value) setLogoPreview(resolveImageUrl(e.target.value)); }}
                  placeholder="https://cdn.example.com/logo.png" className={`${fc} mt-1`} />
              </div>
            </div>
          </div>
        </div>

        {/* Store Name */}
        <div>
          <label className={lc}>Store Name <span className="text-red-400">*</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pearl Traders, TechHub Uganda" className={fc} />
        </div>

        {/* Description */}
        <div>
          <label className={lc}>Store Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
            placeholder="Tell buyers what you sell, your specialisation, and what makes your store unique. Include the types of products or services you offer."
            className={`${fc} resize-none`} />
          <p className="text-[11px] text-gray-400 mt-1">A good description helps buyers find and trust your store. Be specific about your products.</p>
        </div>

        {/* Banner */}
        <div>
          <label className={lc}>Banner Image URL <span className="text-gray-400 font-normal">(1200×300px recommended)</span></label>
          <input value={banner} onChange={(e) => setBanner(e.target.value)}
            placeholder="https://cdn.example.com/banner.jpg" className={fc} />
        </div>

        {/* Contact details note */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3.5 text-xs text-blue-700">
          <p className="font-bold mb-0.5 flex items-center gap-1">💡 Contact Details & Additional Info</p>
          <p>Your <strong>phone number</strong>, <strong>email</strong>, <strong>website</strong>, <strong>social links</strong>, and <strong>business description</strong> are managed under{' '}
            <Link href="/profile" className="underline font-semibold hover:text-blue-900">Profile Settings</Link>.
            They display automatically on your public store page alongside your listings.
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-5">
        <button onClick={handleSave} disabled={saving || uploadingLogo}
          className="px-6 py-2.5 bg-sky-600 text-white text-sm font-semibold rounded-xl hover:bg-sky-700 disabled:opacity-50 transition-colors shadow-sm">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-xl hover:bg-gray-200 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StoreRentalDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { country } = useCountry();
  const router = useRouter();

  const fee = getConvertedFee(country);

  const [rental, setRental]               = useState<Rental | null>(null);
  const [store, setStore]                 = useState<StoreProfile | null>(null);
  const [fetching, setFetching]           = useState(true);
  const [error, setError]                 = useState('');
  const [success, setSuccess]             = useState('');
  const [applying, setApplying]           = useState(false);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [showPayment, setShowPayment]     = useState(false);
  const [pendingRentalData, setPendingRentalData] = useState<{ entityType: string; plan: string } | null>(null);
  const [listingCount, setListingCount]   = useState<number | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingPlacements, setSavingPlacements] = useState(false);

  // Apply form state
  const [entityType, setEntityType] = useState('AGENT');
  const [plan, setPlan]             = useState<'FREE_TRIAL' | 'MONTHLY' | 'ANNUAL'>('MONTHLY');

  // Store identity info — captured at application time so the store has real
  // content from the moment it's created, instead of a generic placeholder name.
  const [applyStoreName, setApplyStoreName]         = useState('');
  const [applyStoreDescription, setApplyStoreDescription] = useState('');
  const [applyStoreCategory, setApplyStoreCategory] = useState('');
  const [applyContactPhone, setApplyContactPhone]   = useState('');
  const [applyFormError, setApplyFormError]         = useState('');

  // Placement prefs
  const [placements, setPlacements] = useState<{ categories: string[]; positions: string[] }>({
    categories: [], positions: [],
  });

  const STORE_PLANS = [
    { id: 'FREE_TRIAL' as const, label: 'Free Trial', feeLabel: '0 AED', durationLabel: '3 days full access', highlight: false },
    { id: 'MONTHLY'   as const, label: 'Monthly Plan', feeLabel: '60 AED', durationLabel: '1 month access', highlight: true },
    { id: 'ANNUAL'    as const, label: 'Annual Plan', feeLabel: '300 AED', durationLabel: '1 year access', highlight: false },
  ];

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth/login');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    if (['AGENT', 'COMPANY', 'ORGANIZATION'].includes(user.role)) setEntityType(user.role);
  }, [user]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    try {
      const [rentalRes, storeRes, listingRes] = await Promise.allSettled([
        api.get('/store-rentals/my'),
        api.get('/stores/me'),
        api.get('/listings?mine=true&limit=1'),
      ]);

      if (rentalRes.status === 'fulfilled') {
        const r = rentalRes.value.data.rental || null;
        setRental(r);
        if (r?.placements) {
          const p = r.placements;
          setPlacements({
            categories: Array.isArray(p.categories) ? p.categories : [],
            positions: Array.isArray(p.positions) ? p.positions : [],
          });
        }
      }
      if (storeRes.status === 'fulfilled') {
        setStore(storeRes.value.data.store || null);
      }
      if (listingRes.status === 'fulfilled') {
        setListingCount(listingRes.value.data.pagination?.total ?? listingRes.value.data.listings?.length ?? 0);
      }
    } finally {
      setFetching(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Application submit (after payment) ─────────────────────────────────────
  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setApplyFormError('');

    // Require store identity info before proceeding — the store is the entry
    // point that groups this entity's listings, so it needs real content.
    if (!applyStoreName.trim()) {
      setApplyFormError('Please enter your store name.');
      return;
    }
    if (!applyStoreDescription.trim()) {
      setApplyFormError('Please describe what your store sells or offers.');
      return;
    }

    // Non-free plans require payment first
    if (plan !== 'FREE_TRIAL') {
      setPendingRentalData({ entityType, plan });
      setShowPayment(true);
      return;
    }
    submitApplication(entityType, plan);
  };

  const submitApplication = async (et: string, pl: string) => {
    setApplying(true);
    setError('');
    try {
      const { data } = await api.post('/store-rentals', {
        entityType: et,
        plan: pl,
        placements: {
          categories: [],
          subscriptionPlan: pl,
          paymentStatus: pl === 'FREE_TRIAL' ? 'WAIVED' : 'PAID',
          storeName: applyStoreName.trim(),
          storeDescription: applyStoreDescription.trim(),
          storeCategory: applyStoreCategory.trim() || undefined,
          contactPhone: applyContactPhone.trim() || undefined,
        },
      });
      setRental(data.rental);
      setShowApplyForm(false);
      setSuccess('Store application submitted! An admin will review and activate your store within 24 hours.');
      fetchData();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Application failed. Please try again.';
      setError(msg);
    } finally {
      setApplying(false);
    }
  };

  const handlePaymentComplete = () => {
    setShowPayment(false);
    if (pendingRentalData) {
      submitApplication(pendingRentalData.entityType, pendingRentalData.plan);
      setPendingRentalData(null);
    }
  };

  const handleSavePlacements = async () => {
    setSavingPlacements(true);
    setError('');
    try {
      await api.patch('/store-rentals/my/placements', { placements });
      setSuccess('Placement preferences saved!');
      setTimeout(() => setSuccess(''), 3000);
    } catch {
      setError('Failed to save placements. Please try again.');
    } finally {
      setSavingPlacements(false);
    }
  };

  const toggleCategory = (cat: string) => {
    setPlacements(prev => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter(c => c !== cat)
        : [...prev.categories, cat],
    }));
  };

  if (authLoading || fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"/>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {showPayment && pendingRentalData && (
        <StorePaymentModal
          fee={fee}
          onPaid={handlePaymentComplete}
          onClose={() => { setShowPayment(false); setPendingRentalData(null); }}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-extrabold text-gray-900">Store Dashboard</h1>
        <Link href="/profile"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 transition-colors">
          ⚙️ Profile Settings
        </Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Manage your Piitrade digital store, listings, and display preferences.</p>

      {error   && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {success && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm">{success}</div>}

      {/* ── No rental yet ── */}
      {!rental && !showApplyForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="text-5xl mb-4">🏪</div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Open Your Store on Piitrade</h2>
          <p className="text-sm text-gray-500 mb-2 max-w-md mx-auto">
            Get a verified digital storefront to showcase your products and reach buyers across UAE, Uganda, Kenya, and China.
          </p>
          {/* Subscription fee prominently displayed */}
          <div className="inline-flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 mb-6">
            <span className="text-violet-600 font-black text-xl">{fee.display}</span>
            <div className="text-left">
              <p className="text-xs font-bold text-violet-700">Annual Subscription</p>
              <p className="text-[11px] text-violet-500">≈ $100 USD · Admin approval required</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mb-6 text-left">
            {[
              { icon: '✅', title: 'Verified Store Page', desc: 'Your own public store page with logo, banner, and listing gallery.' },
              { icon: '📍', title: 'Platform Placements', desc: 'Route listings to Featured Deal, Latest Collections, or Other Collections.' },
              { icon: '🌍', title: 'Multi-Country Reach', desc: 'Buyers across all 4 countries can discover and browse your store.' },
            ].map(item => (
              <div key={item.title} className="bg-gray-50 rounded-xl p-3">
                <p className="font-bold text-gray-800 text-sm mb-0.5">{item.icon} {item.title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setShowApplyForm(true)}
            className="px-8 py-3 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 transition-colors shadow-md">
            Apply for a Store Space
          </button>
        </div>
      )}

      {/* ── Apply form ── */}
      {showApplyForm && !rental && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <h2 className="text-base font-bold text-gray-900 mb-1">Store Application</h2>
          <p className="text-sm text-gray-500 mb-5">Choose your plan and entity type. Non-free plans require payment before submission.</p>

          {/* Subscription fee notice */}
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-5 flex items-center gap-3">
            <span className="text-2xl">💳</span>
            <div>
              <p className="font-bold text-violet-800 text-sm">Store Subscription Fee: {fee.display}</p>
              <p className="text-xs text-violet-600 mt-0.5">This is ≈ $100 USD converted to your country currency ({fee.symbol}). Payment is required before your application is sent for admin review.</p>
            </div>
          </div>

          <form onSubmit={handleApply} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">Account Type</label>
              <div className="grid grid-cols-3 gap-2">
                {ENTITY_TYPES.map(t => (
                  <button key={t} type="button" onClick={() => setEntityType(t)}
                    className={`rounded-lg border-2 py-2.5 text-sm font-medium transition-all ${
                      entityType === t ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 text-gray-600 hover:border-sky-200'}`}>
                    {t === 'AGENT' ? '👤 Agent' : t === 'COMPANY' ? '🏢 Company' : '🌐 Organisation'}
                  </button>
                ))}
              </div>
            </div>

            {/* Store identity — this becomes the entry point that groups this
                entity's listings, so it must carry real, meaningful information
                from the moment the store is created. */}
            <div className="bg-sky-50 border border-sky-100 rounded-xl p-4 space-y-4">
              <p className="text-xs font-bold text-sky-800 flex items-center gap-1.5">
                🏬 Store Information <span className="text-red-400 font-normal">(required)</span>
              </p>

              {applyFormError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">
                  {applyFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Store Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={applyStoreName}
                  onChange={(e) => setApplyStoreName(e.target.value)}
                  placeholder="e.g. Pearl Traders, TechHub Uganda"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  What does your store sell or offer? <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={applyStoreDescription}
                  onChange={(e) => setApplyStoreDescription(e.target.value)}
                  rows={3}
                  placeholder="Describe your products or services, and what makes your store unique. This is what buyers will see on your store page."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Primary Category <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={applyStoreCategory}
                    onChange={(e) => setApplyStoreCategory(e.target.value)}
                    placeholder="e.g. Electronics, Fashion"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Contact Phone <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={applyContactPhone}
                    onChange={(e) => setApplyContactPhone(e.target.value)}
                    placeholder="+256 7XX XXX XXX"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-white"
                  />
                </div>
              </div>

              <p className="text-[11px] text-gray-500">
                💡 You can add your logo and refine these details later from your Store Dashboard once approved.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">Subscription Plan</label>
              <div className="grid gap-2 sm:grid-cols-3">
                {STORE_PLANS.map(item => (
                  <button key={item.id} type="button" onClick={() => setPlan(item.id)}
                    className={`relative rounded-lg border-2 px-3 py-3 text-left transition-colors ${
                      plan === item.id ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-300'}`}>
                    {item.highlight && (
                      <span className="absolute -top-2 right-2 bg-violet-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                        POPULAR
                      </span>
                    )}
                    <p className="text-xs font-bold text-gray-800">{item.label}</p>
                    <p className="text-[11px] text-gray-500">{item.feeLabel}</p>
                    <p className="text-[10px] text-gray-400">{item.durationLabel}</p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {plan === 'FREE_TRIAL'
                  ? '✅ No payment required for the free trial.'
                  : `💳 You will be asked to pay ${fee.display} before submitting.`}
              </p>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={applying}
                className="px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {applying ? 'Submitting…' : plan === 'FREE_TRIAL' ? 'Submit Application' : `Pay ${fee.display} & Apply`}
              </button>
              <button type="button" onClick={() => setShowApplyForm(false)}
                className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Active/Pending rental ── */}
      {rental && (
        <>
          {/* Rental status card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-900">Your Store Subscription</h2>
                <p className="text-xs text-gray-400 mt-0.5">{rental.entityType} plan</p>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[rental.status] || 'bg-gray-100 text-gray-600'}`}>
                {rental.status}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Fee Paid</p>
                <p className="text-sm font-semibold text-gray-800">{rental.currency} {rental.fee.toLocaleString('en-US')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Listings Used</p>
                <p className="text-sm font-semibold text-gray-800">
                  {listingCount !== null ? `${listingCount} / ${rental.maxListings}` : rental.maxListings}
                </p>
                {listingCount !== null && (
                  <div className="mt-1 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (listingCount / rental.maxListings) * 100)}%` }}/>
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Start Date</p>
                <p className="text-sm font-semibold text-gray-800">{formatDate(rental.startDate)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Expires</p>
                <p className="text-sm font-semibold text-gray-800">{formatDate(rental.endDate)}</p>
                {rental.status === 'ACTIVE' && (
                  <p className={`text-[11px] font-semibold ${daysUntil(rental.endDate) <= 7 ? 'text-red-500' : 'text-amber-600'}`}>
                    {daysUntil(rental.endDate)} days left
                  </p>
                )}
              </div>
            </div>

            {rental.status === 'PENDING' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 mb-3">
                ⏳ Your store application is under admin review. You will be notified once it is approved and activated.
              </div>
            )}

            {rental.status === 'ACTIVE' && daysUntil(rental.endDate) <= 14 && (
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-amber-800">⏰ Subscription expiring soon</p>
                  <p className="text-xs text-amber-600 mt-0.5">Renew to keep your store and listings active.</p>
                </div>
                <button onClick={() => setShowApplyForm(true)}
                  className="shrink-0 px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition-colors">
                  Renew
                </button>
              </div>
            )}

            {rental.status === 'ACTIVE' && (
              <div className="flex flex-wrap gap-2">
                <Link href="/listings/create"
                  className="px-4 py-2 bg-sky-600 text-white text-sm font-semibold rounded-lg hover:bg-sky-700 transition-colors">
                  + Post a Listing
                </Link>
                <Link href="/profile/listings"
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                  Manage Listings
                </Link>
                <button onClick={() => setEditingProfile(true)}
                  className="px-4 py-2 border border-sky-200 text-sky-700 text-sm font-medium rounded-lg hover:bg-sky-50 transition-colors">
                  ✏️ Edit Store Profile
                </button>
                {store && (
                  <Link href={`/stores/${store.slug}`}
                    className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                    👁 View Public Store
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* ── Store Profile ── */}
          {rental.status === 'ACTIVE' && (
            <>
              {editingProfile && store ? (
                <StoreProfileEditor
                  store={store}
                  onSaved={(updated) => { setStore(updated); setEditingProfile(false); setSuccess('Store profile updated successfully!'); }}
                  onCancel={() => setEditingProfile(false)}
                />
              ) : store ? (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-5">
                  {/* Banner */}
                  <div className="h-28 bg-gradient-to-br from-sky-400 to-indigo-600 relative">
                    {store.banner && (
                      <Image src={resolveImageUrl(store.banner)} alt="Store banner" fill className="object-cover"/>
                    )}
                    <div className="absolute inset-0 bg-black/20"/>
                    <button onClick={() => setEditingProfile(true)}
                      className="absolute top-2 right-2 bg-white/90 text-gray-700 text-xs font-semibold px-2.5 py-1 rounded-full shadow hover:bg-white transition-colors">
                      ✏️ Edit
                    </button>
                  </div>
                  <div className="flex items-start gap-4 p-4 -mt-8 relative">
                    <div className="w-16 h-16 rounded-xl border-4 border-white shadow-md bg-white flex items-center justify-center overflow-hidden shrink-0">
                      {store.logo
                        ? <Image src={resolveImageUrl(store.logo)} alt={store.name} width={64} height={64} className="object-contain w-full h-full"/>
                        : <span className="text-2xl">🏪</span>}
                    </div>
                    <div className="pt-8 flex-1 min-w-0">
                      <h3 className="font-extrabold text-gray-900 text-base">{store.name}</h3>
                      {store.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{store.description}</p>}
                      <Link href={`/stores/${store.slug}`} className="text-xs text-sky-600 hover:underline mt-1 inline-block">
                        /stores/{store.slug} →
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-700">
                  <p className="font-semibold mb-0.5">⚠️ Store profile not set up</p>
                  <p className="text-xs text-amber-600">Your store page has not been created yet. Contact support or wait for admin activation to provision your store profile.</p>
                </div>
              )}

              {/* ── Listing Placement Routing ── */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
                <h2 className="text-base font-bold text-gray-900 mb-1">Listing Placement Routing</h2>
                <p className="text-xs text-gray-500 mb-4">
                  Choose which homepage sections your listings appear in. You can also control placement per-listing from{' '}
                  <Link href="/profile/listings" className="text-sky-600 underline">Manage Listings</Link>.
                </p>

                <div className="grid gap-3 sm:grid-cols-3 mb-4">
                  {PLACEMENT_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => toggleCategory(opt.value)}
                      className={`relative text-left rounded-xl border-2 p-3.5 transition-all ${
                        placements.categories.includes(opt.value)
                          ? opt.color + ' ring-2 ring-offset-1'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}>
                      {placements.categories.includes(opt.value) && (
                        <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-current text-white flex items-center justify-center text-[8px]">✓</span>
                      )}
                      <p className="font-bold text-sm">{opt.label}</p>
                      <p className="text-[11px] mt-0.5 opacity-80">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700 mb-4">
                  <strong>Note:</strong> Platform partition routing for individual listings is done via the placement dropdown on each listing in{' '}
                  <Link href="/profile/listings" className="underline font-medium">Manage Listings</Link>. The options above set your store-wide preferred partitions.
                </div>

                <button onClick={handleSavePlacements} disabled={savingPlacements}
                  className="px-5 py-2 bg-sky-600 text-white text-sm font-semibold rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors">
                  {savingPlacements ? 'Saving…' : 'Save Placement Preferences'}
                </button>
              </div>

              {/* ── Quick Actions ── */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h2 className="text-base font-bold text-gray-900 mb-3">Quick Actions</h2>
                <div className="grid sm:grid-cols-3 gap-3">
                  {[
                    { href: '/listings/create', icon: '➕', label: 'Post New Listing', desc: 'Add a product or service to your store', color: 'sky' },
                    { href: '/profile/listings', icon: '📋', label: 'Manage Listings', desc: 'Edit, update status, set placement', color: 'indigo' },
                    { href: '/profile', icon: '👤', label: 'Edit Profile', desc: 'Update contact info, bio, and social links', color: 'gray' },
                  ].map(action => (
                    <Link key={action.href} href={action.href}
                      className={`group flex flex-col gap-1.5 p-3.5 rounded-xl border border-gray-100 bg-gray-50 hover:bg-${action.color}-50 hover:border-${action.color}-200 transition-all`}>
                      <span className="text-xl">{action.icon}</span>
                      <p className="font-semibold text-gray-800 text-sm group-hover:text-sky-700 transition-colors">{action.label}</p>
                      <p className="text-xs text-gray-400">{action.desc}</p>
                    </Link>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
