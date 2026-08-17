'use client';

/**
 * CV Builder — Free to build, server-verified payment required to download.
 *
 * Anti-loophole measures:
 * - No download button is rendered before payment confirmation.
 * - No blob URL is created until the server returns { valid: true }.
 * - Print-to-PDF is blocked while unpaid via a CSS @media print rule.
 * - The download is triggered only after /api/cv-payment/validate/:id
 *   returns a valid, paid, unexpired token.
 * - rawToken is held only in React state (not localStorage / URL).
 *
 * Sections (7):
 *  1. Personal Information
 *  2. Professional Summary
 *  3. Work Experience
 *  4. Educational Background
 *  5. Certifications & Awards
 *  6. Skills & Competencies  (with Languages sub-section)
 *  7. References
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCountry } from '@/context/CountryContext';
import Link from 'next/link';
import { api } from '@/lib/api';

// ── Utility ────────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

// ── Types ──────────────────────────────────────────────────────────────────────
interface WorkEntry {
  id: string;
  company: string;
  role: string;
  period: string;
  location: string;
  description: string;
}
interface EduEntry {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  year: string;
  grade?: string;
}
interface CertEntry {
  id: string;
  name: string;
  issuer: string;
  year: string;
  credentialId?: string;
}
interface SkillEntry {
  id: string;
  name: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
}
interface LangEntry {
  id: string;
  language: string;
  proficiency: 'Basic' | 'Conversational' | 'Fluent' | 'Native';
}
interface RefEntry {
  id: string;
  name: string;
  title: string;
  company: string;
  email: string;
  phone: string;
}

interface CVData {
  // Personal
  name: string; title: string; email: string; phone: string;
  location: string; website: string; linkedin: string;
  profilePicture: string; // base64 data URL or empty string
  // Professional summary
  summary: string;
  // Sections
  work: WorkEntry[];
  education: EduEntry[];
  certifications: CertEntry[];
  skills: SkillEntry[];
  languages: LangEntry[];
  references: RefEntry[];
}

const emptyWork    = (): WorkEntry    => ({ id: uid(), company: '', role: '', period: '', location: '', description: '' });
const emptyEdu     = (): EduEntry     => ({ id: uid(), institution: '', degree: '', fieldOfStudy: '', year: '', grade: '' });
const emptyCert    = (): CertEntry    => ({ id: uid(), name: '', issuer: '', year: '', credentialId: '' });
const emptySkill   = (): SkillEntry   => ({ id: uid(), name: '', level: 'Intermediate' });
const emptyLang    = (): LangEntry    => ({ id: uid(), language: '', proficiency: 'Conversational' });
const emptyRef     = (): RefEntry     => ({ id: uid(), name: '', title: '', company: '', email: '', phone: '' });

const INITIAL: CVData = {
  name: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '',
  profilePicture: '',
  summary: '',
  work: [emptyWork()],
  education: [emptyEdu()],
  certifications: [emptyCert()],
  skills: [emptySkill()],
  languages: [emptyLang()],
  references: [emptyRef()],
};

// ── CV Package (admin-governed pricing/limits) ─────────────────────────────────
// The builder never hardcodes a price. Every price shown or charged comes
// straight from the CV-scope package the admin currently has active,
// fetched fresh from /cv-payment/active-package. If that package is marked
// free, the download is issued directly with no payment step at all. If no
// CV package is active, pricing is not yet available and downloading is
// disabled until the admin configures one.
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

// ── Completeness gate ───────────────────────────────────────────────────────────
// The download button must stay disabled until these core details are filled in,
// regardless of which pricing/package rules apply.
function getMissingCvFields(cv: CVData): string[] {
  const missing: string[] = [];
  if (!cv.name.trim())    missing.push('Full Name');
  if (!cv.title.trim())   missing.push('Professional Title');
  if (!cv.email.trim())   missing.push('Email Address');
  if (!cv.phone.trim())   missing.push('Phone Number');
  if (!cv.summary.trim()) missing.push('Professional Summary');

  const w = cv.work[0];
  if (!w || !w.company.trim() || !w.role.trim() || !w.period.trim()) {
    missing.push('Work Experience (company, role & period)');
  }
  const e = cv.education[0];
  if (!e || !e.institution.trim() || !e.degree.trim() || !e.year.trim()) {
    missing.push('Education (institution, degree & year)');
  }
  if (!cv.skills.some(s => s.name.trim()))       missing.push('at least one Skill');
  if (!cv.languages.some(l => l.language.trim())) missing.push('at least one Language');

  return missing;
}

// ── Step labels (7 steps) ──────────────────────────────────────────────────────
const STEPS = ['Personal', 'Summary', 'Experience', 'Education', 'Certs', 'Skills', 'References'];

// ── Skill level colours ────────────────────────────────────────────────────────
const SKILL_LEVEL_COLORS: Record<string, string> = {
  Beginner:     'bg-gray-100 text-gray-600',
  Intermediate: 'bg-sky-100 text-sky-700',
  Advanced:     'bg-indigo-100 text-indigo-700',
  Expert:       'bg-violet-100 text-violet-700',
};
const LANG_PROF_COLORS: Record<string, string> = {
  Basic:           'bg-gray-100 text-gray-600',
  Conversational:  'bg-emerald-100 text-emerald-700',
  Fluent:          'bg-teal-100 text-teal-700',
  Native:          'bg-green-100 text-green-700',
};

// ── CV Preview ─────────────────────────────────────────────────────────────────
function CVPreview({ cv, id, theme }: { cv: CVData; id: string; theme: CVTheme }) {
  const isColoredHeader = theme.headerBg !== 'transparent';
  return (
    <div
      id={id}
      className="bg-white text-gray-900 text-[12px] leading-snug min-h-[600px]"
      style={{ fontFamily: theme.font }}
    >
      {/* ── Themed Header ── */}
      <div
        className="pb-3 mb-4 flex items-start gap-4 px-5 pt-5"
        style={{
          backgroundColor: theme.headerBg,
          borderBottom: isColoredHeader ? 'none' : `2px solid ${theme.accent}`,
          paddingBottom: isColoredHeader ? '16px' : '12px',
          marginBottom: 0,
        }}
      >
        {cv.profilePicture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cv.profilePicture}
            alt="Profile"
            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 4, flexShrink: 0, border: '2px solid rgba(255,255,255,0.3)' }}
          />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: theme.headerText }}>{cv.name || 'Your Name'}</h1>
          <p className="text-sm" style={{ color: theme.subText }}>{cv.title || 'Professional Title'}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px]" style={{ color: theme.subText }}>
            {cv.email    && <span>✉ {cv.email}</span>}
            {cv.phone    && <span>📞 {cv.phone}</span>}
            {cv.location && <span>📍 {cv.location}</span>}
            {cv.website  && <span>🌐 {cv.website}</span>}
            {cv.linkedin && <span>in {cv.linkedin}</span>}
          </div>
        </div>
      </div>

      {/* Body sections */}
      <div className="px-5 sm:px-7 pt-4 pb-5">

      {/* section heading helper rendered inline */}
      {/* ── Professional Summary ── */}
      {cv.summary && (
        <section className="mb-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest mb-1.5 pb-0.5" style={{ color: theme.accent, borderBottom: `1px solid ${theme.sectionLine}` }}>
            Professional Summary
          </h2>
          <p className="text-[12px] leading-relaxed">{cv.summary}</p>
        </section>
      )}

      {/* ── Work Experience ── */}
      {cv.work.some(w => w.company || w.role) && (
        <section className="mb-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest mb-1.5 pb-0.5" style={{ color: theme.accent, borderBottom: `1px solid ${theme.sectionLine}` }}>
            Work Experience
          </h2>
          {cv.work.map(w => (w.company || w.role) ? (
            <div key={w.id} className="mb-2.5">
              <div className="flex justify-between gap-2 items-start">
                <div>
                  <p className="font-bold text-[12px]">{w.role}</p>
                  <p className="italic text-[11px] text-gray-500">{w.company}{w.location ? ` · ${w.location}` : ''}</p>
                </div>
                <p className="text-gray-400 text-[10px] shrink-0 mt-0.5">{w.period}</p>
              </div>
              {w.description && <p className="text-[11px] mt-0.5 text-gray-700">{w.description}</p>}
            </div>
          ) : null)}
        </section>
      )}

      {/* ── Education ── */}
      {cv.education.some(e => e.institution || e.degree) && (
        <section className="mb-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest mb-1.5 pb-0.5" style={{ color: theme.accent, borderBottom: `1px solid ${theme.sectionLine}` }}>
            Educational Background
          </h2>
          {cv.education.map(e => (e.institution || e.degree) ? (
            <div key={e.id} className="mb-2">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-bold text-[12px]">{e.degree}{e.fieldOfStudy ? ` — ${e.fieldOfStudy}` : ''}</p>
                  <p className="italic text-[11px] text-gray-500">{e.institution}{e.grade ? ` · ${e.grade}` : ''}</p>
                </div>
                <p className="text-gray-400 text-[10px] shrink-0 mt-0.5">{e.year}</p>
              </div>
            </div>
          ) : null)}
        </section>
      )}

      {/* ── Certifications & Awards ── */}
      {cv.certifications.some(c => c.name) && (
        <section className="mb-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest mb-1.5 pb-0.5" style={{ color: theme.accent, borderBottom: `1px solid ${theme.sectionLine}` }}>
            Certifications &amp; Awards
          </h2>
          {cv.certifications.map(c => c.name ? (
            <div key={c.id} className="mb-1.5">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-bold text-[12px]">{c.name}</p>
                  <p className="italic text-[11px] text-gray-500">{c.issuer}{c.credentialId ? ` · ID: ${c.credentialId}` : ''}</p>
                </div>
                <p className="text-gray-400 text-[10px] shrink-0 mt-0.5">{c.year}</p>
              </div>
            </div>
          ) : null)}
        </section>
      )}

      {/* ── Skills ── */}
      {cv.skills.some(s => s.name) && (
        <section className="mb-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest mb-1.5 pb-0.5" style={{ color: theme.accent, borderBottom: `1px solid ${theme.sectionLine}` }}>
            Skills &amp; Competencies
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {cv.skills.filter(s => s.name).map(s => (
              <span key={s.id} className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-medium">
                {s.name} <span className="text-gray-400">· {s.level}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── Languages ── */}
      {cv.languages.some(l => l.language) && (
        <section className="mb-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest mb-1.5 pb-0.5" style={{ color: theme.accent, borderBottom: `1px solid ${theme.sectionLine}` }}>
            Languages
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {cv.languages.filter(l => l.language).map(l => (
              <span key={l.id} className="bg-gray-50 border border-gray-200 text-gray-700 px-2 py-0.5 rounded text-[10px] font-medium">
                {l.language} <span className="text-gray-400">· {l.proficiency}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── References ── */}
      {cv.references.some(r => r.name) && (
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-widest mb-1.5 pb-0.5" style={{ color: theme.accent, borderBottom: `1px solid ${theme.sectionLine}` }}>
            References
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {cv.references.filter(r => r.name).map(r => (
              <div key={r.id}>
                <p className="font-bold text-[12px]">{r.name}</p>
                <p className="text-[11px] text-gray-500">{r.title}{r.company ? ` · ${r.company}` : ''}</p>
                {r.email && <p className="text-[10px] text-gray-400">✉ {r.email}</p>}
                {r.phone && <p className="text-[10px] text-gray-400">📞 {r.phone}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}

// ── Payment Modal ──────────────────────────────────────────────────────────────
function PaymentModal({
  country, deviceId, price, holder, onPaid, onClose,
}: {
  country: string;
  deviceId: string;
  price: { amount: string; currency: string };
  holder: { name: string; title: string; email: string; phone: string };
  onPaid: (rawToken: string, tokenId: string) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<'CARD' | 'MOBILE' | 'BANK'>('CARD');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const [cardName, setCardName]     = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc]       = useState('');
  const [mobilePhone, setMobilePhone]     = useState('');
  const [mobileNetwork, setMobileNetwork] = useState('');

  const mobileNetworks = country === 'UGANDA' ? ['MTN Mobile Money', 'Airtel Money']
    : country === 'KENYA'  ? ['M-Pesa', 'Airtel Money']
    : country === 'CHINA'  ? ['WeChat Pay', 'Alipay']
    : ['Mobile Wallet'];

  const handlePay = async () => {
    if (method === 'CARD') {
      if (!cardName.trim() || !cardNumber.replace(/\s/g, '').match(/^\d{13,19}$/) ||
          !cardExpiry.match(/^\d{2}\/\d{2}$/) || !cardCvc.match(/^\d{3,4}$/)) {
        setError('Please complete all card details correctly.');
        return;
      }
    }
    if (method === 'MOBILE' && (!mobilePhone.trim() || mobilePhone.replace(/\D/g, '').length < 9)) {
      setError('Please enter a valid mobile money phone number.');
      return;
    }
    setProcessing(true);
    setError('');
    try {
      const { data: initData } = await api.post('/cv-payment/initiate', { country, deviceId, holder });
      const { tokenId, rawToken } = initData as { tokenId: string; rawToken: string };
      await api.post('/cv-payment/confirm', { rawToken });
      onPaid(rawToken, tokenId);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Payment failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-sm p-6 sm:p-7"
        onClick={e => e.stopPropagation()}>
        <div className="text-center mb-5">
          <div className="w-14 h-14 bg-sky-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">Download Price</h2>
          <p className="text-sm text-gray-500 mt-1">
            <strong className="text-sky-700">{price.amount} {price.currency}</strong>
          </p>
        </div>

        {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{error}</div>}

        <div className="grid grid-cols-3 gap-2 mb-4">
          {([['CARD', '💳', 'Card'], ['MOBILE', '📱', 'Mobile Pay'], ['BANK', '🏦', 'Bank']] as const).map(([v, icon, label]) => (
            <button key={v} type="button" onClick={() => { setMethod(v); setError(''); }}
              className={`py-2.5 rounded-xl text-xs font-semibold border-2 flex flex-col items-center gap-1 transition-all ${
                method === v ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 text-gray-600'}`}>
              <span className="text-base">{icon}</span>{label}
            </button>
          ))}
        </div>

        {method === 'CARD' && (
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Cardholder Name</label>
              <input type="text" value={cardName} onChange={e => setCardName(e.target.value)}
                placeholder="John Smith" autoComplete="cc-name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Card Number</label>
              <input type="text" value={cardNumber} autoComplete="cc-number"
                onChange={e => setCardNumber(e.target.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim())}
                placeholder="1234 5678 9012 3456" maxLength={19}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-300"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Expiry (MM/YY)</label>
                <input type="text" value={cardExpiry} autoComplete="cc-exp"
                  onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setCardExpiry(v.length > 2 ? v.slice(0, 2) + '/' + v.slice(2) : v); }}
                  placeholder="MM/YY" maxLength={5}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-300"/>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">CVC</label>
                <input type="text" value={cardCvc} autoComplete="cc-csc"
                  onChange={e => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="123" maxLength={4}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-300"/>
              </div>
            </div>
          </div>
        )}

        {method === 'MOBILE' && (
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Mobile Network</label>
              <select value={mobileNetwork} onChange={e => setMobileNetwork(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300">
                <option value="">Select network…</option>
                {mobileNetworks.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Phone Number</label>
              <input type="tel" value={mobilePhone} onChange={e => setMobilePhone(e.target.value)}
                placeholder={country === 'UGANDA' ? '+256 700 000000' : country === 'KENYA' ? '+254 700 000000' : '+86 138 0000 0000'}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"/>
            </div>
            <p className="text-xs text-gray-400">You will receive a payment prompt on your phone.</p>
          </div>
        )}

        {method === 'BANK' && (
          <div className="mb-4 bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1 border border-gray-100">
            <p className="font-semibold text-gray-800 mb-2">Bank Transfer Details</p>
            <p>Bank: <span className="font-medium text-gray-800">Piitrade Payments Ltd</span></p>
            <p>Account No: <span className="font-mono font-medium text-gray-800">1234-5678-90</span></p>
            <p>Reference: <span className="font-mono font-bold text-sky-700">CV-{country.slice(0, 2)}-{Date.now().toString().slice(-6)}</span></p>
            <p className="text-gray-400 mt-2 leading-relaxed">Use the exact reference above. Your download unlocks after payment confirmation (typically 1–2 hours).</p>
          </div>
        )}

        <button onClick={handlePay} disabled={processing}
          className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2">
          {processing
            ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Processing…</>
            : <>Confirm Payment</>}
        </button>
        <button onClick={onClose} className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 py-1.5">
          Cancel — keep editing
        </button>
      </div>
    </div>
  );
}

// ── Section header helper ──────────────────────────────────────────────────────
function SectionHeader({ icon, title, onAdd, addLabel }: { icon: string; title: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-semibold text-gray-900 text-sm sm:text-base flex items-center gap-2">
        <span className="text-lg">{icon}</span>{title}
      </h2>
      {onAdd && (
        <button type="button" onClick={onAdd}
          className="text-xs text-sky-600 hover:text-sky-800 font-semibold px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 transition-colors">
          + {addLabel || 'Add'}
        </button>
      )}
    </div>
  );
}

// ── CV Themes ──────────────────────────────────────────────────────────────────
interface CVTheme {
  key: string;
  label: string;
  accent: string;       // header border / section header color (hex)
  headerBg: string;     // name block background
  headerText: string;   // name color
  subText: string;      // title / subtitle color
  sectionLine: string;  // section divider color
  font: string;         // CSS font-family
}

const CV_THEMES: CVTheme[] = [
  {
    key: 'classic',   label: 'Classic',    accent: '#1e293b', headerBg: 'transparent',
    headerText: '#111827', subText: '#6b7280', sectionLine: '#e5e7eb', font: 'Georgia, serif',
  },
  {
    key: 'navy',      label: 'Navy Pro',   accent: '#1e3a5f', headerBg: '#1e3a5f',
    headerText: '#ffffff', subText: '#93c5fd', sectionLine: '#1e3a5f', font: 'Georgia, serif',
  },
  {
    key: 'teal',      label: 'Teal',       accent: '#0f766e', headerBg: '#0f766e',
    headerText: '#ffffff', subText: '#a7f3d0', sectionLine: '#0f766e', font: '"Trebuchet MS", sans-serif',
  },
  {
    key: 'crimson',   label: 'Crimson',    accent: '#9f1239', headerBg: '#9f1239',
    headerText: '#ffffff', subText: '#fda4af', sectionLine: '#9f1239', font: 'Georgia, serif',
  },
  {
    key: 'charcoal',  label: 'Charcoal',   accent: '#374151', headerBg: '#374151',
    headerText: '#f9fafb', subText: '#d1d5db', sectionLine: '#374151', font: '"Arial", sans-serif',
  },
  {
    key: 'violet',    label: 'Violet',     accent: '#5b21b6', headerBg: '#5b21b6',
    headerText: '#ffffff', subText: '#c4b5fd', sectionLine: '#5b21b6', font: 'Georgia, serif',
  },
];

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CVBuilderPage() {
  const { user } = useAuth();
  const { country } = useCountry();
  const previewId = 'cv-preview-content';

  const [cv, setCv]                   = useState<CVData>(INITIAL);
  const [step, setStep]               = useState(0);
  const [showPayment, setShowPayment] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [payToken, setPayToken]       = useState<{ raw: string; id: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError]         = useState('');
  const [activeTheme, setActiveTheme] = useState<CVTheme>(CV_THEMES[0]);
  const [deviceId]                    = useState(() => getOrCreateDeviceId());

  // ── Admin-governed CV package (pricing + rules) ───────────────────────────────
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

  // ── Completeness gate — download stays disabled until these are filled in ────
  const missingFields = React.useMemo(() => getMissingCvFields(cv), [cv]);
  const isCvComplete = missingFields.length === 0;

  // Block print-to-PDF while unpaid
  useEffect(() => {
    const style = document.createElement('style');
    style.id = 'cv-no-print';
    if (!payToken) {
      style.textContent = '@media print { body { display: none !important; } }';
      document.head.appendChild(style);
    }
    return () => { document.getElementById('cv-no-print')?.remove(); };
  }, [payToken]);

  // ── Field helpers ────────────────────────────────────────────────────────────
  const upd = (f: keyof CVData, v: unknown) => setCv((p: CVData) => ({ ...p, [f]: v }));

  // Work
  const updW = (id: string, f: keyof WorkEntry, v: string) =>
    setCv((p: CVData) => ({ ...p, work: p.work.map((w: WorkEntry) => w.id === id ? { ...w, [f]: v } : w) }));
  const addW = () => setCv((p: CVData) => ({ ...p, work: [...p.work, emptyWork()] }));
  const remW = (id: string) => setCv((p: CVData) => ({ ...p, work: p.work.filter((w: WorkEntry) => w.id !== id) }));

  // Education
  const updE = (id: string, f: keyof EduEntry, v: string) =>
    setCv((p: CVData) => ({ ...p, education: p.education.map((e: EduEntry) => e.id === id ? { ...e, [f]: v } : e) }));
  const addE = () => setCv((p: CVData) => ({ ...p, education: [...p.education, emptyEdu()] }));
  const remE = (id: string) => setCv((p: CVData) => ({ ...p, education: p.education.filter((e: EduEntry) => e.id !== id) }));

  // Certifications
  const updC = (id: string, f: keyof CertEntry, v: string) =>
    setCv((p: CVData) => ({ ...p, certifications: p.certifications.map((c: CertEntry) => c.id === id ? { ...c, [f]: v } : c) }));
  const addC = () => setCv((p: CVData) => ({ ...p, certifications: [...p.certifications, emptyCert()] }));
  const remC = (id: string) => setCv((p: CVData) => ({ ...p, certifications: p.certifications.filter((c: CertEntry) => c.id !== id) }));

  // Skills
  const updSk = (id: string, f: keyof SkillEntry, v: string) =>
    setCv((p: CVData) => ({ ...p, skills: p.skills.map((s: SkillEntry) => s.id === id ? { ...s, [f]: v } : s) }));
  const addSk = () => setCv((p: CVData) => ({ ...p, skills: [...p.skills, emptySkill()] }));
  const remSk = (id: string) => setCv((p: CVData) => ({ ...p, skills: p.skills.filter((s: SkillEntry) => s.id !== id) }));

  // Languages
  const updLg = (id: string, f: keyof LangEntry, v: string) =>
    setCv((p: CVData) => ({ ...p, languages: p.languages.map((l: LangEntry) => l.id === id ? { ...l, [f]: v } : l) }));
  const addLg = () => setCv((p: CVData) => ({ ...p, languages: [...p.languages, emptyLang()] }));
  const remLg = (id: string) => setCv((p: CVData) => ({ ...p, languages: p.languages.filter((l: LangEntry) => l.id !== id) }));

  // References
  const updR = (id: string, f: keyof RefEntry, v: string) =>
    setCv((p: CVData) => ({ ...p, references: p.references.map((r: RefEntry) => r.id === id ? { ...r, [f]: v } : r) }));
  const addR = () => setCv((p: CVData) => ({ ...p, references: [...p.references, emptyRef()] }));
  const remR = (id: string) => setCv((p: CVData) => ({ ...p, references: p.references.filter((r: RefEntry) => r.id !== id) }));

  // ── Download as PDF ───────────────────────────────────────────────────────────
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
      const bodyHtml = el?.innerHTML ?? '';
      const fileName = `${(cv.name || 'cv').replace(/\s+/g, '-').toLowerCase()}-cv.pdf`;

      // Build a full, self-contained HTML document that when printed produces
      // a clean A4 PDF. All styles are inlined; the profile picture is already
      // a base64 data URL in the innerHTML so no external requests are needed.
      const printHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${cv.name || 'CV'}</title>
  <style>
    @page { size: A4; margin: 20mm 18mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ${activeTheme.font};
      font-size: 11pt;
      color: #111;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1 { font-size: 18pt; font-weight: 700; color: ${activeTheme.headerText}; }
    .cv-header {
      background-color: ${activeTheme.headerBg !== 'transparent' ? activeTheme.headerBg : '#fff'};
      padding: 14pt;
      margin-bottom: 12pt;
      display: flex;
      align-items: flex-start;
      gap: 12pt;
      ${activeTheme.headerBg === 'transparent' ? `border-bottom: 2pt solid ${activeTheme.accent};` : ''}
    }
    h2 {
      font-size: 8.5pt; text-transform: uppercase;
      letter-spacing: .12em; color: ${activeTheme.accent};
      margin-bottom: 5px; margin-top: 13px;
      border-bottom: 1px solid ${activeTheme.sectionLine}; padding-bottom: 2px;
    }
    p, span, li { font-size: 10.5pt; line-height: 1.5; }
    section { margin-bottom: 12px; page-break-inside: avoid; }
    img { max-width: 72px; max-height: 72px; object-fit: cover; border-radius: 3px; }
    @media print {
      body { margin: 0; }
      button, input, textarea, select { display: none !important; }
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;

      const printWindow = window.open('', '_blank', 'width=800,height=1000');
      if (!printWindow) {
        setDlError('Pop-ups are blocked. Please allow pop-ups for this site and try again.');
        return;
      }
      printWindow.document.write(printHtml);
      printWindow.document.close();
      printWindow.document.title = fileName;
      // Wait for images (profile picture) to load before printing
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          // Close the helper window shortly after the print dialog opens
          setTimeout(() => printWindow.close(), 1000);
        }, 300);
      };
      // Fallback if onload fires before we attach it
      if (printWindow.document.readyState === 'complete') {
        setTimeout(() => {
          printWindow.print();
          setTimeout(() => printWindow.close(), 1000);
        }, 400);
      }
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
        holder: { name: cv.name, title: cv.title, email: cv.email, phone: cv.phone },
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

  // Central click-handler for every download CTA in the page — enforces the
  // "all details completed" gate, requires an active CV package to price
  // against, and routes to the free or paid flow.
  const handleDownloadClick = () => {
    if (!isCvComplete || checkoutLoading || pricingUnavailable) return;
    if (limitReached) return;
    if (isFreePackage) {
      handleFreeDownload();
    } else {
      setShowPayment(true);
    }
  };

  // ── Shared input styles ───────────────────────────────────────────────────────
  const fc = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400';
  const lc = 'block text-xs font-semibold text-gray-600 mb-1';
  const sc = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400';

  // ── Sections ─────────────────────────────────────────────────────────────────

  // Step 0 — Personal Information
  const secPersonal = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm">
      <SectionHeader icon="👤" title="Personal Information" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Profile Picture Upload */}
        <div className="sm:col-span-2">
          <label className={lc}>Profile Picture <span className="text-gray-400 font-normal">(optional)</span></label>
          <div className="flex items-center gap-4">
            {cv.profilePicture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cv.profilePicture}
                alt="Profile preview"
                className="w-16 h-16 rounded-lg object-cover border border-gray-200 shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center shrink-0">
                <span className="text-2xl">👤</span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label className="cursor-pointer inline-flex items-center gap-2 bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold px-3 py-2 rounded-lg border border-sky-200 transition-colors">
                <span>📷</span> {cv.profilePicture ? 'Change Photo' : 'Upload Photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      alert('Image must be under 2 MB.');
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      upd('profilePicture', (ev.target?.result as string) || '');
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {cv.profilePicture && (
                <button
                  type="button"
                  onClick={() => upd('profilePicture', '')}
                  className="text-xs text-red-500 hover:underline text-left"
                >
                  Remove photo
                </button>
              )}
              <p className="text-[10px] text-gray-400">JPG, PNG or WebP · max 2 MB</p>
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className={lc}>Full Name <span className="text-red-400">*</span></label>
          <input value={cv.name} onChange={e => upd('name', e.target.value)} placeholder="Jane Smith" className={fc}/>
        </div>
        <div className="sm:col-span-2">
          <label className={lc}>Professional Title <span className="text-red-400">*</span></label>
          <input value={cv.title} onChange={e => upd('title', e.target.value)} placeholder="Senior Software Engineer" className={fc}/>
        </div>
        <div>
          <label className={lc}>Email Address</label>
          <input type="email" value={cv.email} onChange={e => upd('email', e.target.value)} placeholder="jane@email.com" className={fc}/>
        </div>
        <div>
          <label className={lc}>Phone Number</label>
          <input value={cv.phone} onChange={e => upd('phone', e.target.value)} placeholder="+971 50 123 4567" className={fc}/>
        </div>
        <div className="sm:col-span-2">
          <label className={lc}>Location / City</label>
          <input value={cv.location} onChange={e => upd('location', e.target.value)} placeholder="Dubai, UAE" className={fc}/>
        </div>
        <div>
          <label className={lc}>Website / Portfolio</label>
          <input value={cv.website} onChange={e => upd('website', e.target.value)} placeholder="https://portfolio.dev" className={fc}/>
        </div>
        <div>
          <label className={lc}>LinkedIn Profile</label>
          <input value={cv.linkedin} onChange={e => upd('linkedin', e.target.value)} placeholder="linkedin.com/in/jane" className={fc}/>
        </div>
      </div>
    </div>
  );

  // Step 1 — Professional Summary
  const secSummary = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm">
      <SectionHeader icon="📝" title="Professional Summary" />
      <label className={lc}>Write 3–5 sentences highlighting your experience, key strengths, and career goals.</label>
      <textarea value={cv.summary} onChange={e => upd('summary', e.target.value)} rows={5}
        placeholder="Results-driven professional with 8+ years of experience in software engineering. Specialising in scalable web applications and cross-functional team leadership. Passionate about delivering elegant solutions to complex problems."
        className={`${fc} resize-none`}/>
      <p className="text-[11px] text-gray-400 mt-1.5">{cv.summary.length} characters · recommended 300–600</p>
    </div>
  );

  // Step 2 — Work Experience
  const secWork = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm">
      <SectionHeader icon="💼" title="Work Experience" onAdd={addW} addLabel="Add Position" />
      {cv.work.map((w, i) => (
        <div key={w.id} className={`space-y-2.5 ${i > 0 ? 'mt-5 pt-5 border-t border-gray-100' : ''}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">Position {i + 1}</span>
            {cv.work.length > 1 && (
              <button type="button" onClick={() => remW(w.id)} className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div><label className={lc}>Job Title</label><input value={w.role} onChange={e => updW(w.id, 'role', e.target.value)} placeholder="Senior Engineer" className={fc}/></div>
            <div><label className={lc}>Company Name</label><input value={w.company} onChange={e => updW(w.id, 'company', e.target.value)} placeholder="Acme Corp" className={fc}/></div>
            <div><label className={lc}>Period</label><input value={w.period} onChange={e => updW(w.id, 'period', e.target.value)} placeholder="Jan 2021 – Present" className={fc}/></div>
            <div><label className={lc}>Location</label><input value={w.location} onChange={e => updW(w.id, 'location', e.target.value)} placeholder="Dubai, UAE" className={fc}/></div>
          </div>
          <div>
            <label className={lc}>Key Responsibilities & Achievements</label>
            <textarea value={w.description} onChange={e => updW(w.id, 'description', e.target.value)} rows={3}
              placeholder="• Led development of microservices architecture serving 2M+ users&#10;• Reduced API response time by 40% through caching optimisations"
              className={`${fc} resize-none`}/>
          </div>
        </div>
      ))}
    </div>
  );

  // Step 3 — Educational Background
  const secEdu = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm">
      <SectionHeader icon="🎓" title="Educational Background" onAdd={addE} addLabel="Add Education" />
      {cv.education.map((e, i) => (
        <div key={e.id} className={`space-y-2.5 ${i > 0 ? 'mt-5 pt-5 border-t border-gray-100' : ''}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">Entry {i + 1}</span>
            {cv.education.length > 1 && (
              <button type="button" onClick={() => remE(e.id)} className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div><label className={lc}>Degree / Qualification</label><input value={e.degree} onChange={ev => updE(e.id, 'degree', ev.target.value)} placeholder="B.Sc. Computer Science" className={fc}/></div>
            <div><label className={lc}>Field of Study</label><input value={e.fieldOfStudy} onChange={ev => updE(e.id, 'fieldOfStudy', ev.target.value)} placeholder="Information Technology" className={fc}/></div>
            <div><label className={lc}>Institution</label><input value={e.institution} onChange={ev => updE(e.id, 'institution', ev.target.value)} placeholder="University of Nairobi" className={fc}/></div>
            <div><label className={lc}>Graduation Year</label><input value={e.year} onChange={ev => updE(e.id, 'year', ev.target.value)} placeholder="2018" className={fc}/></div>
            <div className="sm:col-span-2"><label className={lc}>Grade / Classification (optional)</label><input value={e.grade || ''} onChange={ev => updE(e.id, 'grade', ev.target.value)} placeholder="First Class Honours / 3.8 GPA" className={fc}/></div>
          </div>
        </div>
      ))}
    </div>
  );

  // Step 4 — Certifications & Awards
  const secCerts = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm">
      <SectionHeader icon="🏆" title="Certifications & Awards" onAdd={addC} addLabel="Add Certification" />
      <p className="text-xs text-gray-400 mb-3">Include professional certifications, awards, honours, and recognition.</p>
      {cv.certifications.map((c, i) => (
        <div key={c.id} className={`space-y-2.5 ${i > 0 ? 'mt-5 pt-5 border-t border-gray-100' : ''}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">Item {i + 1}</span>
            {cv.certifications.length > 1 && (
              <button type="button" onClick={() => remC(c.id)} className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="sm:col-span-2"><label className={lc}>Certification / Award Name</label><input value={c.name} onChange={e => updC(c.id, 'name', e.target.value)} placeholder="AWS Solutions Architect — Professional" className={fc}/></div>
            <div><label className={lc}>Issuing Organisation</label><input value={c.issuer} onChange={e => updC(c.id, 'issuer', e.target.value)} placeholder="Amazon Web Services" className={fc}/></div>
            <div><label className={lc}>Year Issued</label><input value={c.year} onChange={e => updC(c.id, 'year', e.target.value)} placeholder="2023" className={fc}/></div>
            <div className="sm:col-span-2"><label className={lc}>Credential ID (optional)</label><input value={c.credentialId || ''} onChange={e => updC(c.id, 'credentialId', e.target.value)} placeholder="ABC-123456" className={fc}/></div>
          </div>
        </div>
      ))}
    </div>
  );

  // Step 5 — Skills & Languages (combined step for brevity)
  const secSkillsLangs = (
    <div className="space-y-4">
      {/* Skills */}
      <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm">
        <SectionHeader icon="⚡" title="Skills & Competencies" onAdd={addSk} addLabel="Add Skill" />
        <p className="text-xs text-gray-400 mb-3">Add technical and soft skills with your proficiency level.</p>
        <div className="space-y-2.5">
          {cv.skills.map((s, i) => (
            <div key={s.id} className="flex gap-2 items-start">
              <div className="flex-1">
                <input value={s.name} onChange={e => updSk(s.id, 'name', e.target.value)}
                  placeholder={i === 0 ? 'e.g. React.js' : i === 1 ? 'e.g. Project Management' : 'Skill name'}
                  className={fc}/>
              </div>
              <div className="w-36">
                <select value={s.level} onChange={e => updSk(s.id, 'level', e.target.value)} className={sc}>
                  {(['Beginner', 'Intermediate', 'Advanced', 'Expert'] as SkillEntry['level'][]).map(lv => (
                    <option key={lv} value={lv}>{lv}</option>
                  ))}
                </select>
              </div>
              {cv.skills.length > 1 && (
                <button type="button" onClick={() => remSk(s.id)}
                  className="mt-0.5 text-xs text-red-400 hover:text-red-600 font-medium px-1 shrink-0">✕</button>
              )}
            </div>
          ))}
        </div>
        {/* Live skill preview chips */}
        {cv.skills.some(s => s.name) && (
          <div className="mt-3 flex flex-wrap gap-1.5 pt-3 border-t border-gray-100">
            {cv.skills.filter(s => s.name).map(s => (
              <span key={s.id} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${SKILL_LEVEL_COLORS[s.level]}`}>
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Languages */}
      <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm">
        <SectionHeader icon="🌐" title="Languages" onAdd={addLg} addLabel="Add Language" />
        <p className="text-xs text-gray-400 mb-3">List languages you speak and your proficiency level.</p>
        <div className="space-y-2.5">
          {cv.languages.map((l, i) => (
            <div key={l.id} className="flex gap-2 items-start">
              <div className="flex-1">
                <input value={l.language} onChange={e => updLg(l.id, 'language', e.target.value)}
                  placeholder={i === 0 ? 'e.g. English' : i === 1 ? 'e.g. Arabic' : 'Language'}
                  className={fc}/>
              </div>
              <div className="w-40">
                <select value={l.proficiency} onChange={e => updLg(l.id, 'proficiency', e.target.value)} className={sc}>
                  {(['Basic', 'Conversational', 'Fluent', 'Native'] as LangEntry['proficiency'][]).map(pf => (
                    <option key={pf} value={pf}>{pf}</option>
                  ))}
                </select>
              </div>
              {cv.languages.length > 1 && (
                <button type="button" onClick={() => remLg(l.id)}
                  className="mt-0.5 text-xs text-red-400 hover:text-red-600 font-medium px-1 shrink-0">✕</button>
              )}
            </div>
          ))}
        </div>
        {cv.languages.some(l => l.language) && (
          <div className="mt-3 flex flex-wrap gap-1.5 pt-3 border-t border-gray-100">
            {cv.languages.filter(l => l.language).map(l => (
              <span key={l.id} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${LANG_PROF_COLORS[l.proficiency]}`}>
                {l.language}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Step 6 — References
  const secRefs = (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm">
      <SectionHeader icon="🤝" title="References" onAdd={addR} addLabel="Add Reference" />
      <p className="text-xs text-gray-400 mb-3">Provide professional contacts who can vouch for your work. Ensure you have their permission first.</p>
      {cv.references.map((r, i) => (
        <div key={r.id} className={`space-y-2.5 ${i > 0 ? 'mt-5 pt-5 border-t border-gray-100' : ''}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">Reference {i + 1}</span>
            {cv.references.length > 1 && (
              <button type="button" onClick={() => remR(r.id)} className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div><label className={lc}>Full Name</label><input value={r.name} onChange={e => updR(r.id, 'name', e.target.value)} placeholder="Dr. Robert Chen" className={fc}/></div>
            <div><label className={lc}>Job Title</label><input value={r.title} onChange={e => updR(r.id, 'title', e.target.value)} placeholder="CTO" className={fc}/></div>
            <div><label className={lc}>Company</label><input value={r.company} onChange={e => updR(r.id, 'company', e.target.value)} placeholder="TechVenture Ltd" className={fc}/></div>
            <div><label className={lc}>Email</label><input type="email" value={r.email} onChange={e => updR(r.id, 'email', e.target.value)} placeholder="r.chen@techventure.com" className={fc}/></div>
            <div className="sm:col-span-2"><label className={lc}>Phone (optional)</label><input value={r.phone} onChange={e => updR(r.id, 'phone', e.target.value)} placeholder="+971 50 999 0000" className={fc}/></div>
          </div>
        </div>
      ))}
    </div>
  );

  const stepContent = [secPersonal, secSummary, secWork, secEdu, secCerts, secSkillsLangs, secRefs];

  // ── Download CTA (shared state used by all three CTA locations below) ────────
  const downloadDisabled = !isCvComplete || checkoutLoading || limitReached || pricingUnavailable;
  const downloadBusyLabel = downloading ? '⏳ Preparing…' : null;
  const mainCtaLabel =
    payToken ? '⬇ Download CV (Already Paid)'
    : checkoutLoading ? 'Checking pricing…'
    : pricingUnavailable ? 'Pricing not available'
    : limitReached ? 'Download limit reached'
    : !isCvComplete ? 'Complete all required fields'
    : isFreePackage ? '⬇ Download CV (Free)'
    : 'Proceed to Payment';

  // ── Download CTA ──────────────────────────────────────────────────────────────
  const downloadCTA = (
    <div className="bg-gradient-to-br from-sky-50 to-indigo-50 border border-sky-200 rounded-xl p-5">
      <h3 className="font-bold text-gray-900 mb-1 text-sm flex items-center gap-2">
        <span className="text-lg">📥</span> Ready to download?
      </h3>
      {!checkoutLoading && !pricingUnavailable && price && (
        <p className="text-sm text-gray-600 mb-1">
          {isFreePackage
            ? <>Your CV is ready to download as a PDF — this package is currently <strong className="text-emerald-700">free</strong>.</>
            : <>Your CV is ready to download as a PDF. Download price: <strong>{price.amount} {price.currency}</strong>.</>}
        </p>
      )}
      {pricingUnavailable && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
          Downloading isn&apos;t available right now — no CV package is currently active. Please check back later.
        </p>
      )}
      {activePkg?.maxListings != null && (
        <p className="text-[11px] text-gray-400 mb-2">
          {checkout!.used}/{activePkg.maxListings} download{activePkg.maxListings === 1 ? '' : 's'} used under &ldquo;{activePkg.name}&rdquo;.
        </p>
      )}
      {!isCvComplete && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
          Please complete: {missingFields.join(', ')}.
        </p>
      )}
      {limitReached && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
          You&apos;ve reached the download limit for the current CV package. Please check back later.
        </p>
      )}
      {dlError && <p className="text-xs text-red-600 mb-2">{dlError}</p>}
      {payToken ? (
        <button onClick={() => triggerDownload(payToken.raw, payToken.id)} disabled={downloading}
          className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
          {downloadBusyLabel || mainCtaLabel}
        </button>
      ) : (
        <button onClick={handleDownloadClick} disabled={downloadDisabled}
          className={`w-full py-2.5 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isFreePackage && !downloadDisabled ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'}`}>
          {!downloadDisabled && (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
          )}
          {mainCtaLabel}
        </button>
      )}
      {!user && (
        <p className="mt-2 text-xs text-gray-400 text-center">
          <Link href="/auth/register" className="text-sky-600 hover:underline font-medium">Sign up</Link> to save your CV across sessions.
        </p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50/90">
      {showPayment && price && (
        <PaymentModal
          country={country}
          deviceId={deviceId}
          price={price}
          holder={{ name: cv.name, title: cv.title, email: cv.email, phone: cv.phone }}
          onPaid={onPaid}
          onClose={() => setShowPayment(false)}
        />
      )}

      {/* Mobile preview sheet */}
      {showPreview && (
        <div className="fixed inset-0 z-[200] bg-white flex flex-col sm:hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white sticky top-0">
            <h2 className="font-bold text-sm text-gray-900">CV Preview</h2>
            <div className="flex items-center gap-2">
              {CV_THEMES.map((t) => (
                <button
                  key={t.key}
                  title={t.label}
                  onClick={() => setActiveTheme(t)}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${activeTheme.key === t.key ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: t.accent === 'transparent' ? '#1e293b' : t.accent }}
                />
              ))}
              <button onClick={() => setShowPreview(false)} className="text-sm text-gray-500 font-medium ml-1">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <CVPreview cv={cv} id={previewId} theme={activeTheme}/>
          </div>
          <div className="p-4 border-t bg-white space-y-2">
            {!isCvComplete && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
                Please complete: {missingFields.join(', ')}.
              </p>
            )}
            {limitReached && (
              <p className="text-xs text-red-600 text-center">Download limit reached for the current CV package.</p>
            )}
            {dlError && <p className="text-xs text-red-600 text-center">{dlError}</p>}
            {payToken ? (
              <button onClick={() => triggerDownload(payToken.raw, payToken.id)} disabled={downloading}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                {downloading ? 'Preparing…' : '⬇ Download CV'}
              </button>
            ) : (
              <button onClick={handleDownloadClick} disabled={downloadDisabled}
                className={`w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                  isFreePackage && !downloadDisabled ? 'bg-emerald-600' : 'bg-sky-600'}`}>
                {mainCtaLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="bg-white border-b px-3 sm:px-5 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/cv-generator" className="text-gray-500 hover:text-gray-700 text-sm shrink-0">← Back</Link>
          <span className="text-gray-300 hidden sm:inline">|</span>
          <h1 className="font-bold text-gray-900 text-sm hidden sm:block">CV Builder</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPreview(true)} className="sm:hidden text-xs font-semibold text-sky-600 border border-sky-200 px-3 py-1.5 rounded-lg">
            Preview
          </button>
          {payToken ? (
            <button onClick={() => triggerDownload(payToken.raw, payToken.id)} disabled={downloading}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors disabled:opacity-60">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              {downloading ? 'Preparing…' : 'Download'}
            </button>
          ) : (
            <button onClick={handleDownloadClick} disabled={downloadDisabled}
              title={!isCvComplete ? `Missing: ${missingFields.join(', ')}` : undefined}
              className={`flex items-center gap-1.5 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isFreePackage && !downloadDisabled ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'}`}>
              {!downloadDisabled && (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              )}
              {checkoutLoading ? 'Loading…'
                : pricingUnavailable ? 'Pricing unavailable'
                : limitReached ? 'Limit reached'
                : !isCvComplete ? 'Complete CV'
                : isFreePackage ? 'Download (Free)'
                : 'Proceed to Payment'}
            </button>
          )}
        </div>
      </div>

      {/* Free-use banner */}
      <div className="bg-gradient-to-r from-sky-500 to-blue-600 text-white text-center text-xs sm:text-sm font-medium px-4 py-2">
        {checkoutLoading
          ? <>&#x2705; Build your CV free — checking current download pricing&hellip;</>
          : checkoutError
          ? <>&#x26A0;&#xFE0F; Build your CV free — {checkoutError}{' '}
              <button onClick={fetchCheckoutContext} className="underline font-semibold">Retry</button>
            </>
          : pricingUnavailable
          ? <>&#x2705; Build your CV free — downloads are temporarily unavailable while pricing is configured</>
          : isFreePackage
          ? <>✅ Build your CV free — download is <strong>free</strong> under the current package</>
          : <>✅ Build your CV free — download price: <strong>{price!.amount} {price!.currency}</strong></>}
      </div>


      {dlError && (
        <div className="max-w-7xl mx-auto px-4 pt-3">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-xl">{dlError}</div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">

        {/* ── Mobile: step wizard ── */}
        <div className="sm:hidden mb-4">
          <div className="flex gap-0.5 mb-3 bg-gray-100 rounded-xl p-1">
            {STEPS.map((s, i) => (
              <button key={i} onClick={() => setStep(i)}
                className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition-all ${i === step ? 'bg-white text-sky-600 shadow-sm' : 'text-gray-400'}`}>
                {s}
              </button>
            ))}
          </div>
          {/* Progress bar */}
          <div className="w-full h-1 bg-gray-200 rounded-full mb-4">
            <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}/>
          </div>
          <div>{stepContent[step]}</div>
          <div className="flex gap-2 mt-3">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700">← Back</button>
            )}
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep(s => s + 1)}
                className="flex-1 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">Next →</button>
            ) : (
              <button onClick={() => setShowPreview(true)}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold">Preview &amp; Download</button>
            )}
          </div>
        </div>

        {/* ── Desktop: two-column ── */}
        <div className="hidden sm:grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            {secPersonal}
            {secSummary}
            {secWork}
            {secEdu}
            {secCerts}
            {secSkillsLangs}
            {secRefs}
            {downloadCTA}
          </div>
          <div className="lg:sticky lg:top-[72px] lg:self-start">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-gray-700 text-sm">Live Preview</h2>
                {/* Theme selector */}
                <div className="flex items-center gap-1" title="Choose CV colour theme">
                  {CV_THEMES.map((t) => (
                    <button
                      key={t.key}
                      title={t.label}
                      onClick={() => setActiveTheme(t)}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${
                        activeTheme.key === t.key
                          ? 'border-gray-800 scale-110 shadow-sm'
                          : 'border-transparent hover:border-gray-300'
                      }`}
                      style={{ backgroundColor: t.accent === 'transparent' ? '#1e293b' : t.accent }}
                      aria-label={`Use ${t.label} theme`}
                    />
                  ))}
                </div>
              </div>
              <span className="text-xs text-gray-400">Updates as you type</span>
            </div>
            <div className="rounded-xl overflow-hidden border border-gray-200 shadow-md">
              <CVPreview cv={cv} id={previewId} theme={activeTheme}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
