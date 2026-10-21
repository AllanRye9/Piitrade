'use client';

/**
 * Cover Letter Builder — Free to build, server-verified payment required to download.
 *
 * This is a dedicated building engine that writes only a cover letter
 * (no CV/resume content). It mirrors the CV builder's anti-loophole
 * payment flow:
 * - No download button is rendered before payment confirmation.
 * - No blob URL is created until the server returns { valid: true }.
 * - Print-to-PDF is blocked while unpaid via a CSS @media print rule.
 * - The download is triggered only after /api/cv-payment/validate/:id
 *   returns a valid, paid, unexpired token.
 * - rawToken is held only in React state (not localStorage / URL).
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCountry } from '@/context/CountryContext';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useMomoConfig } from '@/lib/momo';
import { CvMomoPayModal, MomoLoadingShell, MomoUnavailableModal } from '@/components/payments/CvMomoPayModal';

// ── Types ─────────────────────────────────────────────────────────────────────
interface CoverLetterData {
  name: string; email: string; phone: string; location: string;
  hiringManager: string; company: string; role: string;
  opening: string; body: string; closing: string;
}

// ── CV Package (admin-governed pricing/limits) ─────────────────────────────────
// The cover letter builder never hardcodes a price. Every price shown or
// charged comes straight from the CV-scope package the admin currently has
// active, fetched fresh from /cv-payment/active-package. If that package is
// marked free, the download is issued directly with no payment step at
// all. If no CV package is active, pricing is not yet available and
// downloading is disabled until the admin configures one.
interface ActiveCvPackage {
  id: string;
  name: string;
  description?: string | null;
  isFree: boolean;
  price: number;
  currency: string;
  durationDays: number;
  maxListings: number | null;
  createdAt: string;
}
interface CvCheckoutContext {
  package: ActiveCvPackage | null;
  isFree: boolean;
  price: { amount: number; currency: string } | null;
  limit: number | null;
  used: number;
  limitReached: boolean;
}

const DEVICE_ID_KEY = '3re_device_id';
function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = 'device_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'device_' + Math.random().toString(36).slice(2, 11);
  }
}

const INITIAL: CoverLetterData = {
  name: '', email: '', phone: '', location: '',
  hiringManager: '', company: '', role: '',
  opening: '', body: '', closing: '',
};

// ── Cover Letter Preview ──────────────────────────────────────────────────────
function CoverLetterPreview({ cl, id }: { cl: CoverLetterData; id: string }) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <div id={id} className="bg-white text-gray-900 text-[13px] leading-relaxed p-5 sm:p-7 min-h-[520px]"
      style={{ fontFamily: 'Georgia, serif' }}>
      <div className="mb-5">
        <p className="font-bold text-[14px]">{cl.name || 'Your Name'}</p>
        <p className="text-gray-500 font-sans text-[11px] mt-0.5">
          {[cl.email, cl.phone, cl.location].filter(Boolean).join('  ·  ')}
        </p>
      </div>
      <p className="text-gray-500 font-sans text-[11px] mb-4">{today}</p>
      {(cl.hiringManager || cl.company) && (
        <div className="mb-4 text-[12px]">
          {cl.hiringManager && <p>{cl.hiringManager}</p>}
          {cl.company && <p>{cl.company}</p>}
        </div>
      )}
      <p className="mb-3">Dear {cl.hiringManager || 'Hiring Manager'},</p>
      <p className="mb-3">
        {cl.opening || `I am writing to express my interest in the ${cl.role || '[Role]'} position at ${cl.company || '[Company]'}.`}
      </p>
      {cl.body && <p className="mb-3">{cl.body}</p>}
      <p className="mb-3">
        {cl.closing || 'I would welcome the opportunity to discuss how my background and skills align with your needs. Thank you for your time and consideration.'}
      </p>
      <p className="mt-6">Sincerely,</p>
      <p className="font-bold mt-1">{cl.name || 'Your Name'}</p>
    </div>
  );
}

// ── Payment Modal ─────────────────────────────────────────────────────────────
function PaymentModal({
  country, deviceId, price, holder, onPaid, onClose,
}: {
  country: string;
  deviceId: string;
  price: { amount: string; currency: string };
  holder: { name?: string; email?: string; phone?: string };
  onPaid: (rawToken: string, tokenId: string) => void;
  onClose: () => void;
}) {
  // MTN Mobile Money is the only payment method. The download unlocks only after MTN confirms the payment.
  const momo = useMomoConfig();
  if (momo.loading) return <MomoLoadingShell onClose={onClose} />;
  if (!momo.enabled) return <MomoUnavailableModal onClose={onClose} />;
  return <CvMomoPayModal country={country} deviceId={deviceId} holder={holder} price={price} onPaid={onPaid} onClose={onClose} />;
}

// ── Step labels ───────────────────────────────────────────────────────────────
const STEPS = ['Your Details', 'Recipient & Role', 'Letter'];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CoverLetterBuilderPage() {
  const { user } = useAuth();
  const { country } = useCountry();
  const previewId = 'cover-letter-preview-content';

  const [cl, setCl]               = useState<CoverLetterData>(INITIAL);
  const [step, setStep]           = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // Server-issued token — held only in React state, never in URL/localStorage
  const [payToken, setPayToken]   = useState<{ raw: string; id: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError]     = useState('');
  const [deviceId]                = useState(() => getOrCreateDeviceId());

  // ── Admin-governed CV package (pricing + rules) ───────────────────────────────
  // Every click of the download button validates the package the admin currently
  // has active for the CV/cover-letter scope. If it's marked free, the payment
  // modal never appears and the download is issued directly. There is no
  // hardcoded fallback price — if no package is active, pricing simply isn't
  // available yet and downloading stays disabled.
  const [checkout, setCheckout] = useState<CvCheckoutContext | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(true);

  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const fetchCheckoutContext = React.useCallback(() => {
    setCheckoutLoading(true);
    setCheckoutError(null);
    api.get('/cv-payment/active-package', { params: { country, deviceId } })
      .then(({ data }) => setCheckout(data as CvCheckoutContext))
      .catch((err) => {
        // Don't silently swallow this — a failed fetch (404 route not
        // mounted, network error, 500, etc.) looks identical to "no package
        // configured" from the UI's point of view, which makes real bugs
        // impossible to diagnose. Surface it instead.
        const status = err?.response?.status;
        const msg = err?.response?.data?.message || err?.message || 'Unknown error';
        console.error('[cv-generator] failed to load active CV package:', status, msg);
        setCheckout(null);
        setCheckoutError(
          status ? `Couldn't reach pricing service (HTTP ${status}: ${msg})` : `Couldn't reach pricing service (${msg})`
        );
      })
      .finally(() => setCheckoutLoading(false));
  }, [country, deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    fetchCheckoutContext();
  }, [deviceId, fetchCheckoutContext]);

  const activePkg     = checkout?.package ?? null;
  const isFreePackage = !!checkout?.isFree;
  const limitReached  = !!checkout?.limitReached;
  // No admin CV package is active (or its window has expired) — there is
  // nothing to charge and nothing to show, so downloading stays disabled.
  const pricingUnavailable = !checkoutLoading && !checkout?.price;
  // The price shown/charged, sourced solely from the active package. Never
  // a hardcoded fallback — null until the package data has loaded.
  const price = checkout?.price
    ? { amount: String(checkout.price.amount), currency: checkout.price.currency }
    : null;

  // Block print-to-PDF while unpaid
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'cl-no-print';
    if (!payToken) {
      style.textContent = '@media print { body { display: none !important; } }';
      document.head.appendChild(style);
    }
    return () => { document.getElementById('cl-no-print')?.remove(); };
  }, [payToken]);

  const upd = (f: keyof CoverLetterData, v: string) => setCl(p => ({ ...p, [f]: v }));

  // Server-verified download
  const triggerDownload = async (raw: string, tid: string) => {
    setDownloading(true);
    setDlError('');
    try {
      const { data } = await api.get(`/cv-payment/validate/${tid}?rawToken=${encodeURIComponent(raw)}`);
      if (!(data as { valid: boolean }).valid) {
        setDlError('Payment could not be verified. Please try again.');
        return;
      }
      const el = document.getElementById(previewId);
      const html = el?.innerHTML ?? '';
      const full = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${cl.name||'Cover Letter'}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Georgia,serif;color:#111;padding:32px;max-width:700px;margin:0 auto;line-height:1.6}</style></head><body>${html}</body></html>`;
      const blob = new Blob([full], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${(cl.name||'cover-letter').replace(/\s+/g,'-').toLowerCase()}-cover-letter.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDlError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const onPaid = (raw: string, tid: string) => {
    setShowPayment(false);
    setPayToken({ raw, id: tid });
    triggerDownload(raw, tid);
  };

  // Free-package flow: no payment modal at all — issue an already-paid token
  // directly (server still enforces the package's max-generations limit) and
  // go straight to the download.
  const handleFreeDownload = async () => {
    setDlError('');
    try {
      const { data } = await api.post('/cv-payment/free-download', {
        country, deviceId,
        holder: { name: cl.name, email: cl.email, phone: cl.phone },
      });
      const { tokenId, rawToken } = data as { tokenId: string; rawToken: string };
      setPayToken({ raw: rawToken, id: tokenId });
      await triggerDownload(rawToken, tokenId);
      setCheckout(prev => prev ? { ...prev, used: prev.used + 1, limitReached: prev.limit != null && prev.used + 1 >= prev.limit } : prev);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setDlError(msg || 'Free download failed. Please try again.');
    }
  };

  // Central click-handler for every download CTA on this page — validates the
  // admin-governed package before deciding whether to skip payment or open
  // the payment modal.
  const handleDownloadClick = () => {
    if (checkoutLoading || limitReached || pricingUnavailable) return;
    if (isFreePackage) {
      handleFreeDownload();
    } else {
      setShowPayment(true);
    }
  };

  const fc = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-400';
  const lc = 'block text-xs font-semibold text-gray-600 mb-1';

  // ── Section components ───────────────────────────────────────────────────
  const secYou = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm space-y-3">
      <h2 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
        <span className="text-lg">&#x1F464;</span> Your Details
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label className={lc}>Full Name</label><input value={cl.name} onChange={e=>upd('name',e.target.value)} placeholder="Jane Smith" className={fc}/></div>
        <div><label className={lc}>Email</label><input type="email" value={cl.email} onChange={e=>upd('email',e.target.value)} placeholder="jane@email.com" className={fc}/></div>
        <div><label className={lc}>Phone</label><input value={cl.phone} onChange={e=>upd('phone',e.target.value)} placeholder="+971 50 123 4567" className={fc}/></div>
        <div className="sm:col-span-2"><label className={lc}>Location</label><input value={cl.location} onChange={e=>upd('location',e.target.value)} placeholder="Dubai, UAE" className={fc}/></div>
      </div>
    </div>
  );

  const secRecipient = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm space-y-3">
      <h2 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
        <span className="text-lg">&#x1F3E2;</span> Recipient &amp; Role
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label className={lc}>Company Name</label><input value={cl.company} onChange={e=>upd('company',e.target.value)} placeholder="Acme Inc." className={fc}/></div>
        <div className="sm:col-span-2"><label className={lc}>Role You&apos;re Applying For</label><input value={cl.role} onChange={e=>upd('role',e.target.value)} placeholder="Senior Engineer" className={fc}/></div>
        <div className="sm:col-span-2"><label className={lc}>Hiring Manager Name (optional)</label><input value={cl.hiringManager} onChange={e=>upd('hiringManager',e.target.value)} placeholder="Leave blank to use 'Hiring Manager'" className={fc}/></div>
      </div>
    </div>
  );

  const secLetter = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm space-y-3">
      <h2 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
        <span className="text-lg">&#x1F4DD;</span> Letter Content
      </h2>
      <div>
        <label className={lc}>Opening Paragraph</label>
        <textarea value={cl.opening} onChange={e=>upd('opening',e.target.value)} rows={3} placeholder={`I am writing to express my interest in the ${cl.role||'[Role]'} position at ${cl.company||'[Company]'}.`} className={fc}/>
      </div>
      <div>
        <label className={lc}>Body — Why You&apos;re a Fit</label>
        <textarea value={cl.body} onChange={e=>upd('body',e.target.value)} rows={4} placeholder="Highlight relevant experience, achievements, and skills." className={fc}/>
      </div>
      <div>
        <label className={lc}>Closing Paragraph</label>
        <textarea value={cl.closing} onChange={e=>upd('closing',e.target.value)} rows={3} placeholder="I would welcome the opportunity to discuss how my background aligns with your needs." className={fc}/>
      </div>
    </div>
  );

  const stepContent = [secYou, secRecipient, secLetter];

  return (
    <div className="min-h-screen bg-gray-50/90">
      {showPayment && price && (
        <PaymentModal
          country={country}
          deviceId={deviceId}
          price={price}
          holder={{ name: cl.name, email: cl.email, phone: cl.phone }}
          onPaid={onPaid}
          onClose={()=>setShowPayment(false)}
        />
      )}

      {/* Mobile preview sheet */}
      {showPreview && (
        <div className="fixed inset-0 z-[200] bg-white flex flex-col sm:hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white sticky top-0">
            <h2 className="font-bold text-sm text-gray-900">Preview</h2>
            <button onClick={()=>setShowPreview(false)} className="text-sm text-gray-500 font-medium">Close ✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <CoverLetterPreview cl={cl} id={previewId}/>
          </div>
          <div className="p-4 border-t bg-white space-y-2">
            {limitReached && (
              <p className="text-xs text-red-600 text-center">Download limit reached for the current package.</p>
            )}
            {pricingUnavailable && (
              <p className="text-xs text-amber-700 text-center">Downloading isn&apos;t available right now — no package is active.</p>
            )}
            {dlError && <p className="text-xs text-red-600 text-center">{dlError}</p>}
            {payToken ? (
              <button onClick={()=>triggerDownload(payToken.raw, payToken.id)} disabled={downloading}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2">
                {downloading ? 'Preparing…' : '&#x2B07; Download Cover Letter'}
              </button>
            ) : (
              <button onClick={handleDownloadClick} disabled={checkoutLoading || limitReached || pricingUnavailable}
                className="w-full py-3 rounded-xl bg-pink-600 text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {checkoutLoading ? 'Loading…'
                  : pricingUnavailable ? 'Pricing unavailable'
                  : limitReached ? 'Limit reached'
                  : isFreePackage ? 'Download (Free)'
                  : 'Proceed to Payment'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="bg-white border-b px-3 sm:px-5 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/cv-generator" className="text-gray-500 hover:text-gray-700 text-sm shrink-0">&#8592; Back</Link>
          <span className="text-gray-300 hidden sm:inline">|</span>
          <h1 className="font-bold text-gray-900 text-sm hidden sm:block">Cover Letter Builder</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setShowPreview(true)} className="sm:hidden text-xs font-semibold text-pink-600 border border-pink-200 px-3 py-1.5 rounded-lg">
            Preview
          </button>
          {payToken ? (
            <button onClick={()=>triggerDownload(payToken.raw, payToken.id)} disabled={downloading}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              {downloading ? 'Preparing…' : 'Download'}
            </button>
          ) : (
            <button onClick={handleDownloadClick} disabled={checkoutLoading || limitReached || pricingUnavailable}
              className="flex items-center gap-1.5 bg-pink-600 hover:bg-pink-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              {checkoutLoading ? 'Loading…'
                : pricingUnavailable ? 'Pricing unavailable'
                : limitReached ? 'Limit reached'
                : isFreePackage ? 'Download (Free)'
                : 'Proceed to Payment'}
            </button>
          )}
        </div>
      </div>

      {/* Free-use banner */}
      <div className="bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white text-center text-xs sm:text-sm font-medium px-4 py-2">
        {checkoutLoading
          ? <>&#x2705; Write your cover letter free — checking current download pricing&hellip;</>
          : checkoutError
          ? <>&#x26A0;&#xFE0F; Write your cover letter free — {checkoutError}{' '}
              <button onClick={fetchCheckoutContext} className="underline font-semibold">Retry</button>
            </>
          : pricingUnavailable
          ? <>&#x2705; Write your cover letter free — downloads are temporarily unavailable while pricing is configured</>
          : isFreePackage
          ? <>&#x2705; Write your cover letter free — download is <strong>free</strong> under the current package</>
          : <>&#x2705; Write your cover letter free — download price: <strong>{price!.amount} {price!.currency}</strong></>}
      </div>

      {dlError && (
        <div className="max-w-7xl mx-auto px-4 pt-3">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-xl">{dlError}</div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {/* Mobile step progress */}
        <div className="sm:hidden mb-4">
          <div className="flex gap-1 mb-2">
            {STEPS.map((s,i)=>(
              <button key={i} onClick={()=>setStep(i)} className="flex-1 flex flex-col items-center gap-1">
                <div className={`w-full h-1.5 rounded-full ${i<=step?'bg-pink-500':'bg-gray-200'}`}/>
                <span className={`text-[10px] ${i===step?'text-pink-600 font-bold':'text-gray-400'}`}>{s}</span>
              </button>
            ))}
          </div>
          <div>{stepContent[step]}</div>
          <div className="flex gap-2 mt-3">
            {step>0&&<button onClick={()=>setStep(s=>s-1)} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700">&#8592; Back</button>}
            {step<STEPS.length-1
              ? <button onClick={()=>setStep(s=>s+1)} className="flex-1 py-2.5 rounded-xl bg-pink-600 text-white text-sm font-semibold">Next &#8594;</button>
              : <button onClick={()=>setShowPreview(true)} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold">Preview &amp; Download</button>
            }
          </div>
        </div>

        {/* Desktop: two-column */}
        <div className="hidden sm:grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Editor */}
          <div className="space-y-4">
            {secYou}
            {secRecipient}
            {secLetter}
            {/* Download CTA */}
            <div className="bg-pink-50 border border-pink-200 rounded-xl p-5">
              <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-2"><span className="text-lg">&#x1F4E5;</span> Ready to download?</h3>
              {!checkoutLoading && !pricingUnavailable && price && (
                <p className="text-sm text-gray-600 mb-1">
                  {isFreePackage
                    ? <>Your cover letter is ready to download — this package is currently <strong className="text-emerald-700">free</strong>.</>
                    : <>Your cover letter is ready to download. Download price: <strong>{price.amount} {price.currency}</strong>.</>}
                </p>
              )}
              {pricingUnavailable && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                  Downloading isn&apos;t available right now — no package is currently active. Please check back later.
                </p>
              )}
              {activePkg?.maxListings != null && (
                <p className="text-[11px] text-gray-400 mb-2">
                  {checkout!.used}/{activePkg.maxListings} download{activePkg.maxListings === 1 ? '' : 's'} used under &ldquo;{activePkg.name}&rdquo;.
                </p>
              )}
              {limitReached && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
                  You&apos;ve reached the download limit for the current package. Please check back later.
                </p>
              )}
              {dlError && <p className="text-xs text-red-600 mb-2">{dlError}</p>}
              {payToken ? (
                <button onClick={()=>triggerDownload(payToken.raw, payToken.id)} disabled={downloading}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2">
                  {downloading ? 'Preparing…' : '&#x2B07; Download Cover Letter (Already Paid)'}
                </button>
              ) : (
                <button onClick={handleDownloadClick} disabled={checkoutLoading || limitReached || pricingUnavailable}
                  className="w-full py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                  {checkoutLoading ? 'Loading…'
                    : pricingUnavailable ? 'Pricing unavailable'
                    : limitReached ? 'Limit reached'
                    : isFreePackage ? 'Download (Free)'
                    : 'Proceed to Payment'}
                </button>
              )}
              {!user && <p className="mt-2 text-xs text-gray-400 text-center"><Link href="/auth/register" className="text-pink-600 hover:underline font-medium">Sign up</Link> to save your cover letter.</p>}
            </div>
          </div>

          {/* Live preview */}
          <div className="lg:sticky lg:top-[72px] lg:self-start">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-700 text-sm">Live Preview</h2>
              <span className="text-xs text-gray-400">Updates as you type</span>
            </div>
            <div className="rounded-xl overflow-hidden border border-gray-200 shadow-md">
              <CoverLetterPreview cl={cl} id={previewId}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
