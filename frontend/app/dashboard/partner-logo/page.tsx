'use client';

/**
 * /dashboard/partner-logo
 *
 * Available to users whose store has partnerApproved=true.
 * Lets them upload their company logo that appears on the public
 * /stores Partners wall. If not yet approved, they see a pending notice.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

interface StoreData {
  partnerApproved:  boolean;
  partnerLogoUrl:   string | null;
  partnerName:      string | null;
  partnerWebsite:   string | null;
  name:             string;
  slug:             string;
}

export default function PartnerLogoPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [store, setStore]           = useState<StoreData | null>(null);
  const [fetching, setFetching]     = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [removing, setRemoving]     = useState(false);
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null);
  const [preview, setPreview]       = useState<string | null>(null);
  const [partnerName, setPartnerName]     = useState('');
  const [partnerWebsite, setPartnerWebsite] = useState('');
  const [uploadedUrl, setUploadedUrl]     = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth/login?redirect=/dashboard/partner-logo');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    api.get('/stores/me')
      .then(({ data }) => {
        const s: StoreData = data.store;
        setStore(s);
        setPartnerName(s.partnerName || '');
        setPartnerWebsite(s.partnerWebsite || '');
        if (s.partnerLogoUrl) setUploadedUrl(s.partnerLogoUrl);
      })
      .catch(() => setStore(null))
      .finally(() => setFetching(false));
  }, [user]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client preview
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload to CDN via existing upload endpoint
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('images', file);
      const { data } = await api.post('/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url: string = data.urls?.[0] || data.url || '';
      if (!url) throw new Error('No URL returned');
      setUploadedUrl(url);
      showToast('Image uploaded — click Save to publish', true);
    } catch {
      showToast('Upload failed — please try again', false);
      setPreview(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!uploadedUrl) { showToast('Please upload a logo first', false); return; }
    setSaving(true);
    try {
      const { data } = await api.put('/stores/me/partner-logo', {
        partnerLogoUrl: uploadedUrl,
        partnerName:    partnerName.trim() || undefined,
        partnerWebsite: partnerWebsite.trim() || undefined,
      });
      setStore(data.store);
      showToast('Partner logo published on the Partners wall ✓', true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message || 'Save failed';
      showToast(msg, false);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove your logo from the Partners wall?')) return;
    setRemoving(true);
    try {
      await api.delete('/stores/me/partner-logo');
      setStore((prev) => prev ? { ...prev, partnerLogoUrl: null } : prev);
      setUploadedUrl(null);
      setPreview(null);
      showToast('Logo removed from Partners wall', true);
    } catch {
      showToast('Remove failed — please try again', false);
    } finally {
      setRemoving(false);
    }
  };

  if (authLoading || fetching) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentLogoSrc = preview || (uploadedUrl ? resolveImageUrl(uploadedUrl) : null);

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold text-white ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-7">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-2xl shadow-md shrink-0">
          🤝
        </div>
        <div>
          <h1 className="text-2xl font-black text-gray-900">Partner Logo</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload your company logo to appear on the public{' '}
            <Link href="/stores" className="text-sky-600 hover:underline font-semibold">Partners wall</Link>.
          </p>
        </div>
      </div>

      {/* Not approved state */}
      {!store?.partnerApproved ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <div className="text-4xl mb-3">⏳</div>
          <h2 className="font-bold text-amber-900 text-lg mb-2">Awaiting Partner Approval</h2>
          <p className="text-sm text-amber-800 mb-4">
            Your store must be approved as a partner by the 3R-Elite admin team before you can upload a logo to the Partners wall.
          </p>
          <p className="text-xs text-amber-700">
            Already have a store? Contact support or check your store status below.
          </p>
          {store && (
            <Link href={`/stores/${store.slug}`}
              className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors">
              View My Store →
            </Link>
          )}
          {!store && (
            <Link href="/dashboard/store-rental"
              className="inline-block mt-4 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors">
              Open a Store First →
            </Link>
          )}
        </div>
      ) : (
        /* Approved — show upload form */
        <div className="space-y-5">

          {/* Current logo preview */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="font-bold text-gray-800 text-sm mb-4">Company Logo</h2>

            <div className="flex items-center gap-5">
              {/* Preview box */}
              <div className="w-28 h-28 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                {currentLogoSrc ? (
                  <Image src={currentLogoSrc} alt="Partner logo preview" width={112} height={112} className="object-contain p-2" />
                ) : (
                  <div className="text-center">
                    <div className="text-3xl mb-1">🖼️</div>
                    <p className="text-[10px] text-gray-400 font-medium">No logo</p>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-sky-300 text-sky-700 font-semibold text-sm hover:bg-sky-50 transition-colors disabled:opacity-50"
                >
                  {uploading ? (
                    <><div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /> Uploading…</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg> Choose Logo Image</>
                  )}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                <p className="text-[10px] text-gray-400 text-center">
                  PNG, JPG or SVG · Recommended: 300 × 300 px · max 5 MB
                </p>
                {store.partnerLogoUrl && !preview && (
                  <button onClick={handleRemove} disabled={removing}
                    className="w-full text-xs text-red-500 hover:text-red-700 font-semibold disabled:opacity-50">
                    {removing ? 'Removing…' : '× Remove from Partners wall'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Partner details */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="font-bold text-gray-800 text-sm">Display Details</h2>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Display Name <span className="text-gray-400 font-normal">(shown below logo on Partners wall)</span>
              </label>
              <input type="text" value={partnerName} onChange={(e) => setPartnerName(e.target.value)}
                placeholder={store.name}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Website URL <span className="text-gray-400 font-normal">(optional — logo links here)</span></label>
              <input type="url" value={partnerWebsite} onChange={(e) => setPartnerWebsite(e.target.value)}
                placeholder="https://yourcompany.com"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || uploading || !uploadedUrl}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition-all text-sm"
          >
            {saving ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
            ) : (
              <>✓ Publish to Partners Wall</>
            )}
          </button>

          <p className="text-center text-xs text-gray-400">
            Your logo appears immediately on the{' '}
            <Link href="/stores" className="text-sky-600 hover:underline">Partners wall</Link>{' '}
            after saving.
          </p>
        </div>
      )}
    </div>
  );
}
