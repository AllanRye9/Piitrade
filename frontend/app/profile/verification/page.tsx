'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { fetchKycImageObjectUrl } from '@/lib/kycImage';
import { Breadcrumb } from '@/components/ui/Breadcrumb';

type KycStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
type DocumentType = 'NATIONAL_ID' | 'PASSPORT' | 'DRIVERS_LICENSE' | 'BUSINESS_LICENSE';

interface KycState {
  kycStatus: KycStatus;
  kycDocumentType?: DocumentType | null;
  kycDocumentUrl?: string | null;
  kycDocumentBackUrl?: string | null;
  kycSelfieUrl?: string | null;
  kycFullName?: string | null;
  kycSubmittedAt?: string | null;
  kycReviewedAt?: string | null;
  kycRejectionReason?: string | null;
}

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  NATIONAL_ID: 'National ID Card',
  PASSPORT: 'Passport',
  DRIVERS_LICENSE: "Driver's License",
  BUSINESS_LICENSE: 'Business License',
};

// Document types that need both sides uploaded. Everything else (passport,
// business licence) is a single page/document — see backend/src/routes/kyc.ts
// TWO_SIDED_DOCUMENT_TYPES, which is the source of truth this mirrors.
const TWO_SIDED_TYPES: DocumentType[] = ['NATIONAL_ID', 'DRIVERS_LICENSE'];

// What to call the single upload field for single-sided types.
const SINGLE_SIDE_LABEL: Record<DocumentType, string> = {
  NATIONAL_ID: 'Photo of Document',
  PASSPORT: "Photo of Passport (Identity/Information Page)",
  DRIVERS_LICENSE: 'Photo of Document',
  BUSINESS_LICENSE: 'Photo of Business License',
};

async function uploadKycImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('image', file);
  const { data } = await api.post('/upload/kyc-document', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.url as string;
}

interface KycDraft {
  kycDraftDocumentType?: DocumentType | null;
  kycDraftFullName?: string | null;
  kycDraftDocumentUrl?: string | null;
  kycDraftDocumentBackUrl?: string | null;
  kycDraftSelfieUrl?: string | null;
  kycDraftUpdatedAt?: string | null;
}

// Saves the current draft server-side. Sensitive KYC documents must never
// sit in browser storage while the user is mid-flow, so every field is
// persisted through this endpoint instead — a refresh, closed tab, dropped
// connection, or accidental navigation-away never loses progress. Best
// effort: a failed draft save shouldn't block the user from continuing to
// fill out the form, it just means resume-on-refresh won't have that field.
async function saveDraft(patch: {
  documentType?: DocumentType;
  fullName?: string;
  documentUrl?: string | null;
  documentBackUrl?: string | null;
  selfieUrl?: string | null;
}): Promise<void> {
  try {
    await api.put('/kyc/draft', patch);
  } catch {
    // Best effort — see comment above.
  }
}

export default function VerificationPage() {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const router = useRouter();

  const [state, setState] = useState<KycState | null>(null);
  const [loading, setLoading] = useState(true);

  // ?for=webstore | partner adds the brief business form on top of the documents. Read from the URL
  // after mount so this page needs no Suspense boundary.
  const [purpose, setPurpose] = useState<'PERSONAL' | 'WEBSTORE' | 'PARTNER'>('PERSONAL');
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('for')?.toUpperCase();
    if (f === 'WEBSTORE' || f === 'PARTNER') setPurpose(f);
  }, []);
  const isBusiness = purpose !== 'PERSONAL';
  const [businessName, setBusinessName] = useState('');
  const [businessRegNumber, setBusinessRegNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const [documentType, setDocumentType] = useState<DocumentType>('NATIONAL_ID');
  const [fullName, setFullName] = useState('');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentPreview, setDocumentPreview] = useState<string | null>(null);
  // Back-of-document upload — only shown/required for two-sided types
  // (national ID, driver's licence). Cleared automatically when the user
  // switches to a single-sided type so a stale back-image from a previous
  // selection can never be submitted alongside e.g. a passport.
  const [documentBackFile, setDocumentBackFile] = useState<File | null>(null);
  const [documentBackPreview, setDocumentBackPreview] = useState<string | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  // Server-side URLs for images that have already been uploaded (either
  // just now, in this session, or restored from a saved draft on a
  // previous visit). Submitting re-uses these instead of re-uploading —
  // and restoring a draft can populate the preview/"already uploaded"
  // state here without ever having a browser File object at all.
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentBackUrl, setDocumentBackUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [uploadingField, setUploadingField] = useState<'document' | 'documentBack' | 'selfie' | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const documentBackInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  const requiresBack = TWO_SIDED_TYPES.includes(documentType);

  const handleDocumentTypeChange = (nextType: DocumentType) => {
    setDocumentType(nextType);
    if (!TWO_SIDED_TYPES.includes(nextType)) {
      // Switched to a single-sided type — drop any back-side upload so it
      // can't be silently carried over and submitted with the new type.
      setDocumentBackFile(null);
      setDocumentBackPreview(null);
      setDocumentBackUrl(null);
      if (documentBackInputRef.current) documentBackInputRef.current.value = '';
    }
    saveDraft({ documentType: nextType });
  };

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !user) router.push('/auth/login?redirect=/profile/verification');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    setFullName(user.name || '');
    api.get('/kyc/status')
      .then(({ data }) => setState(data))
      .catch(() => setState(null))
      .finally(() => setLoading(false));
  }, [user]);

  // Resumable workflow: once we know verification hasn't already been
  // submitted, restore any in-progress draft (document type, name, and
  // already-uploaded images) saved server-side from a previous visit —
  // covers a refresh, closed tab, dropped connection, or navigating away
  // mid-flow. Documents themselves were never in browser storage, only on
  // the server, so there's nothing sensitive to restore from the client.
  useEffect(() => {
    if (!user || !state) return;
    if (state.kycStatus !== 'NOT_SUBMITTED' && state.kycStatus !== 'REJECTED') return;
    api.get<KycDraft>('/kyc/draft')
      .then(({ data }) => {
        const hasDraft = !!(data.kycDraftDocumentType || data.kycDraftFullName || data.kycDraftDocumentUrl);
        if (!hasDraft) return;
        if (data.kycDraftDocumentType) setDocumentType(data.kycDraftDocumentType);
        if (data.kycDraftFullName) setFullName(data.kycDraftFullName);
        if (data.kycDraftDocumentUrl) {
          setDocumentUrl(data.kycDraftDocumentUrl);
          fetchKycImageObjectUrl(data.kycDraftDocumentUrl).then(setDocumentPreview).catch(() => undefined);
        }
        if (data.kycDraftDocumentBackUrl) {
          setDocumentBackUrl(data.kycDraftDocumentBackUrl);
          fetchKycImageObjectUrl(data.kycDraftDocumentBackUrl).then(setDocumentBackPreview).catch(() => undefined);
        }
        if (data.kycDraftSelfieUrl) {
          setSelfieUrl(data.kycDraftSelfieUrl);
          fetchKycImageObjectUrl(data.kycDraftSelfieUrl).then(setSelfiePreview).catch(() => undefined);
        }
        setDraftRestored(true);
      })
      .catch(() => { /* no draft, or fetch failed — start with a blank form */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, state?.kycStatus]);

  const handleFileSelect = (
    files: FileList | null,
    setFile: (f: File | null) => void,
    setPreview: (p: string | null) => void,
    field: 'document' | 'documentBack' | 'selfie',
    setUrl: (u: string | null) => void,
    draftKey: 'documentUrl' | 'documentBackUrl' | 'selfieUrl',
  ) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setError('Only JPG, PNG, or WEBP images are allowed');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10 MB');
      return;
    }
    setError('');
    setFile(file);
    setUrl(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPreview(reader.result);
    };
    reader.readAsDataURL(file);

    // Upload right away (rather than waiting for final submit) and save it
    // to the server-side draft, so the image survives a refresh/close/
    // connection loss even before the form is ever submitted.
    setUploadingField(field);
    uploadKycImage(file)
      .then((url) => {
        setUrl(url);
        saveDraft({ [draftKey]: url } as Parameters<typeof saveDraft>[0]);
      })
      .catch(() => {
        setError('Failed to upload image. Please try again.');
      })
      .finally(() => setUploadingField((f) => (f === field ? null : f)));
  };

  const handleFullNameBlur = () => {
    if (fullName.trim().length >= 2) saveDraft({ fullName: fullName.trim() });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim() || fullName.trim().length < 2) {
      setError('Please enter your full legal name as it appears on your ID.');
      return;
    }
    if (isBusiness) {
      if (businessName.trim().length < 2) { setError('Enter your business or store name.'); return; }
      if (!/^\+?[0-9][0-9\s-]{7,18}$/.test(phone.trim())) { setError('Enter a valid contact phone number, e.g. +256 700 123456.'); return; }
      if (address.trim().length < 5) { setError('Enter your business address.'); return; }
    }
    if (!documentUrl && !documentFile) {
      setError(requiresBack ? 'Please upload the front of your ID.' : 'Please upload a clear photo of your ID document.');
      return;
    }
    if (requiresBack && !documentBackUrl && !documentBackFile) {
      setError('Please upload the back of your ID.');
      return;
    }
    if (uploadingField) {
      setError('Please wait for the image upload to finish.');
      return;
    }

    setSubmitting(true);
    try {
      // Prefer already-uploaded draft URLs; only upload here if a file was
      // selected but, for some reason, hasn't finished uploading yet.
      const finalDocumentUrl = documentUrl || (documentFile ? await uploadKycImage(documentFile) : undefined);
      const finalDocumentBackUrl = requiresBack
        ? (documentBackUrl || (documentBackFile ? await uploadKycImage(documentBackFile) : undefined))
        : undefined;
      const finalSelfieUrl = selfieUrl || (selfieFile ? await uploadKycImage(selfieFile) : undefined);

      const { data } = await api.post('/kyc/submit', {
        documentType,
        documentUrl: finalDocumentUrl,
        documentBackUrl: finalDocumentBackUrl,
        selfieUrl: finalSelfieUrl,
        fullName: fullName.trim(),
        purpose,
        ...(isBusiness ? {
          businessName: businessName.trim(),
          businessRegNumber: businessRegNumber.trim(),
          phone: phone.trim(),
          address: address.trim(),
        } : {}),
      });

      setState((prev) => ({ ...(prev || {} as KycState), ...data }));
      await refreshUser();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to submit your verification. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-5 animate-pulse space-y-3">
        <div className="h-4 shimmer rounded w-1/3" />
        <div className="h-64 shimmer rounded-2xl" />
      </div>
    );
  }

  const status = state?.kycStatus ?? 'NOT_SUBMITTED';

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 sm:py-6 animate-fade-in">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Profile', href: '/profile' },
          { label: 'Identity Verification' },
        ]}
      />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        <h1 className="text-2xl font-black text-gray-900 mb-1">Identity Verification (KYC)</h1>
        <p className="text-sm text-gray-500 mb-6">
          Verified sellers get priority review on new listings, appear higher in search results,
          and show a trust badge that helps buyers find them.
        </p>
        {isBusiness && (
          <div className="mb-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <p className="font-semibold">{purpose === 'WEBSTORE' ? 'Webstore' : 'Partner'} verification</p>
            <p className="mt-0.5 text-xs text-sky-800">
              {purpose === 'WEBSTORE'
                ? 'A Webstore needs verified ownership before it can be activated. Fill in the short form and upload your documents; once submitted you can apply for your Webstore while we review it.'
                : 'Partners must be verified before they can be approved. Fill in the short form and upload your documents.'}
            </p>
            {purpose === 'WEBSTORE' && (state?.kycStatus === 'PENDING' || state?.kycStatus === 'APPROVED') && (
              <Link href="/dashboard/store-rental" className="mt-2 inline-block rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-800">Continue to Webstore application →</Link>
            )}
          </div>
        )}

        {/* ── APPROVED ── */}
        {status === 'APPROVED' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">You&apos;re KYC Verified</h2>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Your identity was verified on{' '}
              {state?.kycReviewedAt ? new Date(state.kycReviewedAt).toLocaleDateString() : 'record'}.
              Your listings now get priority review and your profile shows the verified badge.
            </p>
            <Link
              href="/profile/listings"
              className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
            >
              View My Listings
            </Link>
          </div>
        )}

        {/* ── PENDING ── */}
        {status === 'PENDING' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-amber-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Verification Pending</h2>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Your documents were submitted
              {state?.kycSubmittedAt ? ` on ${new Date(state.kycSubmittedAt).toLocaleDateString()}` : ''} and are
              awaiting admin review. This usually takes 24–48 hours.
            </p>
          </div>
        )}

        {/* ── NOT_SUBMITTED / REJECTED → show form ── */}
        {(status === 'NOT_SUBMITTED' || status === 'REJECTED') && (
          <>
            {draftRestored && (
              <div className="mb-4 flex items-center gap-2 p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-800">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                We restored your in-progress verification details from your last visit.
              </div>
            )}
            {status === 'REJECTED' && state?.kycRejectionReason && (
              <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-sm font-semibold text-red-800 mb-0.5">Your previous submission was rejected</p>
                <p className="text-xs text-red-700">{state.kycRejectionReason}</p>
                <p className="text-xs text-red-600 mt-1">You can correct the issue and resubmit below.</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-1.5">
                  Document Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={documentType}
                  onChange={(e) => handleDocumentTypeChange(e.target.value as DocumentType)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 transition-shadow"
                >
                  {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((dt) => (
                    <option key={dt} value={dt}>{DOCUMENT_LABELS[dt]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-800 mb-1.5">
                  Full Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onBlur={handleFullNameBlur}
                  placeholder="As it appears on your ID"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 transition-shadow"
                />
              </div>

              {isBusiness && (
                <div className="space-y-4 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <p className="text-sm font-bold text-gray-800">Business details</p>
                  {([
                    ['Business / store name', businessName, setBusinessName, 'e.g. Kampala Fresh Supplies Ltd', true, 'text'],
                    ['Registration number (if registered)', businessRegNumber, setBusinessRegNumber, 'URSB / TIN / licence number', false, 'text'],
                    ['Contact phone', phone, setPhone, '+256 700 123456', true, 'tel'],
                    ['Business address', address, setAddress, 'Street, town / district', true, 'text'],
                  ] as [string, string, (v: string) => void, string, boolean, string][]).map(([label, value, set, ph, req, type]) => (
                    <div key={label}>
                      <label className="block text-sm font-bold text-gray-800 mb-1.5">{label}{req && <span className="text-red-500"> *</span>}</label>
                      <input
                        type={type}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        placeholder={ph}
                        maxLength={type === 'tel' ? 30 : 300}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
                      />
                    </div>
                  ))}
                  <p className="text-xs text-gray-500">Upload your ID below. For a registered business you can choose &ldquo;Business licence&rdquo; as the document type.</p>
                </div>
              )}

              {/* Required-documents summary — shown so the user knows up
                  front what this document type needs, per the "display
                  required documents / front-back requirements" UX spec. */}
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
                <p className="text-xs font-bold text-gray-700 mb-1">Required for {DOCUMENT_LABELS[documentType]}:</p>
                <p className="text-xs text-gray-500">
                  {requiresBack
                    ? 'Front and back photos of the document.'
                    : documentType === 'PASSPORT'
                    ? "Just the identity/information page — no back-side upload needed."
                    : 'A single clear photo of the document.'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-800 mb-1.5">
                  {requiresBack ? `${SINGLE_SIDE_LABEL[documentType]} — Front` : SINGLE_SIDE_LABEL[documentType]} <span className="text-red-500">*</span>
                </label>
                <input
                  ref={documentInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleFileSelect(e.target.files, setDocumentFile, setDocumentPreview, 'document', setDocumentUrl, 'documentUrl')}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 transition-colors"
                />
                {documentPreview && (
                  <div className="relative mt-2 inline-block max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={documentPreview} alt="Document preview" className="max-h-48 max-w-full rounded-xl border border-gray-200 object-contain" />
                    {uploadingField === 'document' ? (
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold bg-white/90 text-gray-600 px-1.5 py-0.5 rounded-full shadow-sm">Uploading…</span>
                    ) : documentUrl ? (
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold bg-emerald-600/90 text-white px-1.5 py-0.5 rounded-full shadow-sm">Saved</span>
                    ) : null}
                  </div>
                )}
              </div>

              {requiresBack && (
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-1.5">
                    {SINGLE_SIDE_LABEL[documentType]} — Back <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={documentBackInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => handleFileSelect(e.target.files, setDocumentBackFile, setDocumentBackPreview, 'documentBack', setDocumentBackUrl, 'documentBackUrl')}
                    className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 transition-colors"
                  />
                  {documentBackPreview && (
                    <div className="relative mt-2 inline-block max-w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={documentBackPreview} alt="Document back preview" className="max-h-48 max-w-full rounded-xl border border-gray-200 object-contain" />
                      {uploadingField === 'documentBack' ? (
                        <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold bg-white/90 text-gray-600 px-1.5 py-0.5 rounded-full shadow-sm">Uploading…</span>
                      ) : documentBackUrl ? (
                        <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold bg-emerald-600/90 text-white px-1.5 py-0.5 rounded-full shadow-sm">Saved</span>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-gray-800 mb-1.5">
                  Selfie Holding the Document <span className="text-gray-400 font-normal">(optional, speeds up review)</span>
                </label>
                <input
                  ref={selfieInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleFileSelect(e.target.files, setSelfieFile, setSelfiePreview, 'selfie', setSelfieUrl, 'selfieUrl')}
                  className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100 transition-colors"
                />
                {selfiePreview && (
                  <div className="relative mt-2 inline-block max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={selfiePreview} alt="Selfie preview" className="max-h-48 max-w-full rounded-xl border border-gray-200 object-contain" />
                    {uploadingField === 'selfie' ? (
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold bg-white/90 text-gray-600 px-1.5 py-0.5 rounded-full shadow-sm">Uploading…</span>
                    ) : selfieUrl ? (
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold bg-emerald-600/90 text-white px-1.5 py-0.5 rounded-full shadow-sm">Saved</span>
                    ) : null}
                  </div>
                )}
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !!uploadingField}
                className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors disabled:opacity-50 shadow-sm interactive"
              >
                {submitting ? 'Submitting…' : uploadingField ? 'Uploading…' : 'Submit for Verification'}
              </button>
            </form>

            <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl">
              <h3 className="text-xs font-bold text-red-800 mb-2">Why verify?</h3>
              <ul className="text-xs text-red-700 space-y-1">
                <li>• Your new listings get priority in the admin review queue</li>
                <li>• A &quot;KYC Verified&quot; badge appears on your profile and listings</li>
                <li>• Verified sellers rank higher in buyer search results</li>
                <li>• Documents are reviewed only by our admin team, never shown publicly</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
