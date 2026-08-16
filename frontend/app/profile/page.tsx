'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { UserAvatar } from '@/components/ui/UserAvatar';
import AvatarCropper from '@/components/ui/AvatarCropper';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { resolveImageUrl } from '@/lib/utils';
import { useDocumentFileUrl } from '@/hooks/useDocumentFileUrl';
import { downloadUserDocument } from '@/lib/documents';

interface ListingSummary {
  id: string;
  title: string;
  price: number;
  currency: string;
  status: string;
  images: string[];
  createdAt: string;
}

interface UserDoc {
  id: string;
  type: 'CV' | 'CERTIFICATE' | 'PORTFOLIO' | 'OTHER';
  title: string;
  description?: string | null;
  fileUrl: string;
  fileName: string;
  fileSize?: number | null;
  isPublic: boolean;
  createdAt: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  CV: '📄 CV / Résumé',
  CERTIFICATE: '🏆 Certificate',
  PORTFOLIO: '🎨 Portfolio',
  OTHER: '📎 Other',
};

const DOC_ICONS: Record<string, string> = {
  CV: '📄',
  CERTIFICATE: '🏆',
  PORTFOLIO: '🎨',
  OTHER: '📎',
};

function DocPreviewModal({ doc, onClose }: { doc: UserDoc; onClose: () => void }) {
  const { url: fileUrl, loading: fileLoading } = useDocumentFileUrl(doc.id);
  const ext = doc.fileName?.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4 border-b border-gray-100 shrink-0">
          <span className="text-2xl shrink-0">{DOC_ICONS[doc.type] || '📎'}</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 truncate">{doc.title}</p>
            <p className="text-xs text-gray-500">{doc.type} · {doc.fileName}</p>
          </div>
          <button
            onClick={() => downloadUserDocument(doc.id, doc.fileName)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            ⬇ Download
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close preview"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-gray-50">
          {fileLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
            </div>
          ) : !fileUrl ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <div className="text-6xl">{DOC_ICONS[doc.type] || '📎'}</div>
              <p className="text-gray-500 text-sm">Couldn&apos;t load this file.</p>
            </div>
          ) : isPdf ? (
            <iframe
              src={fileUrl}
              className="w-full h-full min-h-[70vh]"
              title={doc.title}
            />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={doc.title} className="max-w-full mx-auto block p-4" />
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="text-6xl">{DOC_ICONS[doc.type] || '📎'}</div>
              <p className="text-gray-600 font-medium">{doc.fileName}</p>
              <p className="text-gray-400 text-xs">Preview isn&apos;t available for this file type — download to view.</p>
              <button
                onClick={() => downloadUserDocument(doc.id, doc.fileName)}
                className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                Download File
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, updateUser, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    country: 'UAE' as import('@/lib/types').Country,
    cvThemeColor: '',
    companyName: '',
    registrationNumber: '',
    agentLicense: '',
    agentType: '',
    website: '',
    businessDescription: '',
    socialTwitter: '',
    socialInstagram: '',
    socialLinkedin: '',
    socialFacebook: '',
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [myListings, setMyListings] = useState<ListingSummary[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsPage, setListingsPage] = useState(1);
  const [listingsTotalPages, setListingsTotalPages] = useState(1);
  const [documents, setDocuments] = useState<UserDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [docForm, setDocForm] = useState({ type: 'CV', title: '', description: '' });
  const [docError, setDocError] = useState('');
  const [docSuccess, setDocSuccess] = useState('');
  const [selectedDocFile, setSelectedDocFile] = useState<File | null>(null);
  const [selectedDocPreview, setSelectedDocPreview] = useState<string | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const [previewDoc, setPreviewDoc] = useState<UserDoc | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
    if (user) {
      setForm({
        name: user.name,
        phone: user.phone || '',
        country: user.country,
        cvThemeColor: user.cvThemeColor || '',
        companyName: user.companyName || '',
        registrationNumber: user.registrationNumber || '',
        agentLicense: user.agentLicense || '',
        agentType: user.agentType || '',
        website: user.website || '',
        businessDescription: user.businessDescription || '',
        socialTwitter: user.socialLinks?.twitter || '',
        socialInstagram: user.socialLinks?.instagram || '',
        socialLinkedin: user.socialLinks?.linkedin || '',
        socialFacebook: user.socialLinks?.facebook || '',
      });
      setListingsLoading(true);
      api.get(`/listings?limit=6&page=${listingsPage}&sort=createdAt&mine=true`)
        .then(({ data }) => {
          setMyListings(data.listings || []);
          setListingsTotalPages(data.pagination?.pages || 1);
        })
        .catch(() => setMyListings([]))
        .finally(() => setListingsLoading(false));
      setDocsLoading(true);
      api.get('/upload/documents')
        .then(({ data }) => setDocuments(data.documents || []))
        .catch(() => setDocuments([]))
        .finally(() => setDocsLoading(false));
    }
  }, [user, loading, router, listingsPage]);

  useEffect(() => {
    return () => {
      if (selectedDocPreview) URL.revokeObjectURL(selectedDocPreview);
    };
  }, [selectedDocPreview]);

  // Deep-link support for e.g. /profile#cv-documents (used by "Upload CV"
  // links across the app). The page shows a loading skeleton until `user`
  // resolves (see the `if (loading || !user)` early return below), so the
  // target section doesn't exist in the DOM yet when the browser first
  // tries to honor the URL hash — scroll to it manually once it's mounted.
  useEffect(() => {
    if (loading || !user) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    // Wait a tick for the section (and anything above it) to finish laying out.
    const id = window.requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [loading, user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.put('/users/me', {
        name: form.name,
        phone: form.phone,
        country: form.country,
        cvThemeColor: form.cvThemeColor,
        companyName: form.companyName,
        registrationNumber: form.registrationNumber,
        agentLicense: form.agentLicense,
        agentType: form.agentType,
        website: form.website,
        businessDescription: form.businessDescription,
        socialLinks: {
          twitter: form.socialTwitter,
          instagram: form.socialInstagram,
          linkedin: form.socialLinkedin,
          facebook: form.socialFacebook,
        },
      });
      updateUser(data);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const [copiedId, setCopiedId] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  const handleCopyId = () => {
    if (user?.personalId) {
      navigator.clipboard.writeText(user.personalId).then(() => {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      }).catch(() => {});
    }
  };

  const handleAvatarUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAvatarError('');
    const file = files[0];
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setAvatarError('Only JPG, PNG, WEBP, or GIF images are allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5 MB');
      return;
    }
    // Show cropper with the selected image
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCropSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCroppedUpload = async (blob: Blob) => {
    setCropSrc(null);
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('image', blob, 'avatar.jpg');
      const { data: uploadData } = await api.post('/upload/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (uploadData.urls && uploadData.urls.length > 0) {
        const { data: userData } = await api.put('/users/me', { avatar: uploadData.urls[0] });
        updateUser(userData);
      }
    } catch {
      setAvatarError('Failed to upload photo. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleAvatarDelete = async () => {
    if (!window.confirm('Are you sure you want to remove your profile photo?')) return;
    setAvatarError('');
    setUploadingAvatar(true);
    try {
      const { data: userData } = await api.put('/users/me', { avatar: null });
      updateUser(userData);
    } catch {
      setAvatarError('Failed to remove photo. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleDocUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = selectedDocFile || docFileRef.current?.files?.[0];
    if (!file) { setDocError('Please select a file to upload.'); return; }
    if (!docForm.title.trim()) { setDocError('Please enter a document title.'); return; }
    setDocUploading(true);
    setDocError('');
    setDocSuccess('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', docForm.type);
      fd.append('title', docForm.title.trim());
      if (docForm.description.trim()) fd.append('description', docForm.description.trim());
      await api.post('/upload/document', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDocSuccess('Document uploaded successfully!');
      setDocForm({ type: 'CV', title: '', description: '' });
      if (docFileRef.current) docFileRef.current.value = '';
      setSelectedDocFile(null);
      if (selectedDocPreview) {
        URL.revokeObjectURL(selectedDocPreview);
        setSelectedDocPreview(null);
      }
      const { data } = await api.get('/upload/documents');
      setDocuments(data.documents || []);
      setTimeout(() => setDocSuccess(''), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setDocError(msg || 'Failed to upload document. Please try again.');
    } finally {
      setDocUploading(false);
    }
  };

  const handleDocDelete = async (docId: string) => {
    if (!confirm('Delete this document?')) return;
    try {
      await api.delete(`/upload/documents/${docId}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      // ignore
    }
  };

  const handleDocFileChange = (files: FileList | null) => {
    if (!files?.length) {
      setSelectedDocFile(null);
      if (selectedDocPreview) {
        URL.revokeObjectURL(selectedDocPreview);
        setSelectedDocPreview(null);
      }
      return;
    }

    const file = files[0];
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setDocError('Supported file types: PDF, DOC, DOCX, JPG, PNG, WEBP.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setDocError('File size must be under 10 MB.');
      return;
    }

    setDocError('');
    setSelectedDocFile(file);
    if (selectedDocPreview) {
      URL.revokeObjectURL(selectedDocPreview);
    }
    setSelectedDocPreview(URL.createObjectURL(file));
  };

  if (loading || !user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-5 animate-pulse space-y-3">
        <div className="h-8 shimmer rounded-full w-1/3" />
        <div className="bg-white rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 shimmer rounded-full" />
            <div className="space-y-2 flex-1">
              <div className="h-5 shimmer rounded-full w-1/2" />
              <div className="h-4 shimmer rounded-full w-1/3" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 animate-fade-in">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'My Profile' },
        ]}
      />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900">My Profile</h1>
        <Link
          href="/listings"
          className="inline-flex items-center gap-2 px-4 py-2 bg-elite-navy text-white text-sm font-semibold rounded-xl hover:bg-elite-charcoal transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Visit Marketplace
        </Link>
      </div>

      {/* Theme colour picker */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-sky-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
          <span className="text-sm font-semibold text-gray-700">Site Theme</span>
        </div>
        <ThemeSwitcher compact />
      </div>

      {/* Avatar cropper modal */}
      {cropSrc && (
        <AvatarCropper
          imageSrc={cropSrc}
          onCropComplete={handleCroppedUpload}
          onCancel={() => setCropSrc(null)}
        />
      )}

      {/* Profile header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
        {/* Banner with gold gradient */}
        <div className="h-24 bg-gradient-to-r from-elite-navy via-[#0369a1] to-elite-gold" />
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 -mt-12">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
            <div className="relative group">
              <div className="ring-4 ring-white rounded-full shadow-lg overflow-hidden w-24 h-24 border-2 border-elite-gold/30">
                <UserAvatar user={user} size="lg" />
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => handleAvatarUpload(e.target.files)}
              />
            </div>
            <div className="pb-1 flex-1">
              <p className="text-xl font-extrabold text-gray-900 break-words">{user.name}</p>
              <div className="mt-1 inline-flex items-center gap-1.5 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1">
                <span className="text-sm text-sky-700 font-mono font-semibold tracking-widest whitespace-nowrap select-all">
                  {user.personalId || '—'}
                </span>
                {user.personalId && (
                  <button
                    type="button"
                    onClick={handleCopyId}
                    title="Copy your unique ID"
                    className="text-sky-400 hover:text-sky-600 transition-colors flex-shrink-0"
                    aria-label="Copy unique ID"
                  >
                    {copiedId ? (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    )}
                  </button>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0EA5E9] text-white text-xs font-semibold hover:bg-[#0284c7] transition-colors disabled:opacity-50"
                  aria-label="Upload profile photo"
                >
                  {uploadingAvatar ? (
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  )}
                  Upload Photo
                </button>
                {user.avatar && (
                  <button
                    type="button"
                    onClick={handleAvatarDelete}
                    disabled={uploadingAvatar}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-500 text-xs font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
                    aria-label="Remove profile photo"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Delete
                  </button>
                )}
              </div>
            </div>
            <div className="sm:ml-auto pb-1">
              <span className={`badge text-xs ${user.isVerified ? 'badge-new' : 'bg-amber-100 text-amber-700'}`}>
                {user.isVerified ? '✓ Verified' : '⚡ Unverified'}
              </span>
            </div>
          </div>
          {avatarError && (
            <p className="text-xs text-red-500 mt-2">{avatarError}</p>
          )}
        </div>
      </div>

      {/* Edit form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6 mb-4">
        <h2 className="font-bold text-gray-900 mb-4 text-base flex items-center gap-2">
          <svg className="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          Edit Profile
        </h2>

        {success && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3.5 text-sm mb-4 animate-scale-in">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Profile updated successfully!
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Full Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-premium"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+971 50 000 0000"
              className="input-premium"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Country</label>
            <select
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value as import('@/lib/types').Country })}
              className="input-premium"
            >
              <option value="UAE">🇦🇪 UAE</option>
              <option value="UGANDA">🇺🇬 Uganda</option>
              <option value="KENYA">🇰🇪 Kenya</option>
              <option value="CHINA">🇨🇳 China</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              CV Page Theme Color
              <span className="ml-2 text-xs font-normal text-gray-400">— shown on your public CV profile</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.cvThemeColor || '#0EA5E9'}
                onChange={(e) => setForm({ ...form, cvThemeColor: e.target.value })}
                className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
              />
              <div className="flex gap-2 flex-wrap">
                {['#0EA5E9','#10B981','#8B5CF6','#F59E0B','#EF4444','#EC4899','#0369A1','#064E3B'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, cvThemeColor: c })}
                    className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{ backgroundColor: c, borderColor: form.cvThemeColor === c ? '#000' : '#e5e7eb' }}
                    title={c}
                  />
                ))}
              </div>
              {form.cvThemeColor && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, cvThemeColor: '' })}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Reset
                </button>
              )}
            </div>
            {form.cvThemeColor && (
              <Link
                href={`/jobs/${user?.id}`}
                target="_blank"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: form.cvThemeColor }}
              >
                Preview your CV page →
              </Link>
            )}
          </div>

          {/* Business / Organization Details */}
          {(['AGENT', 'COMPANY', 'ORGANIZATION', 'ADMIN'] as import('@/lib/types').Role[]).includes(user.role) && (
            <div className="border-t border-gray-100 pt-4 mt-2 space-y-4">
              <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 00-1-1H9a1 1 0 00-1 1v5m4 0H9" /></svg>
                Business Information
              </h3>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Business / Company Name</label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  placeholder="Your company or trading name"
                  className="input-premium"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Business Description</label>
                <textarea
                  value={form.businessDescription}
                  onChange={(e) => setForm({ ...form, businessDescription: e.target.value })}
                  placeholder="Describe your business, products, or services"
                  rows={3}
                  className="input-premium resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Website</label>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  placeholder="https://yourwebsite.com"
                  className="input-premium"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Registration Number</label>
                  <input
                    type="text"
                    value={form.registrationNumber}
                    onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                    placeholder="Business reg. number"
                    className="input-premium"
                  />
                </div>
                {user.role === 'AGENT' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Agent License</label>
                    <input
                      type="text"
                      value={form.agentLicense}
                      onChange={(e) => setForm({ ...form, agentLicense: e.target.value })}
                      placeholder="Agent license number"
                      className="input-premium"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Social Media Links */}
          <div className="border-t border-gray-100 pt-4 mt-2 space-y-3">
            <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              Social Media Links <span className="text-gray-400 font-normal text-xs ml-1">(optional)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">𝕏 / Twitter</label>
                <input
                  type="url"
                  value={form.socialTwitter}
                  onChange={(e) => setForm({ ...form, socialTwitter: e.target.value })}
                  placeholder="https://x.com/username"
                  className="input-premium text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Instagram</label>
                <input
                  type="url"
                  value={form.socialInstagram}
                  onChange={(e) => setForm({ ...form, socialInstagram: e.target.value })}
                  placeholder="https://instagram.com/username"
                  className="input-premium text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">LinkedIn</label>
                <input
                  type="url"
                  value={form.socialLinkedin}
                  onChange={(e) => setForm({ ...form, socialLinkedin: e.target.value })}
                  placeholder="https://linkedin.com/in/username"
                  className="input-premium text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Facebook</label>
                <input
                  type="url"
                  value={form.socialFacebook}
                  onChange={(e) => setForm({ ...form, socialFacebook: e.target.value })}
                  placeholder="https://facebook.com/username"
                  className="input-premium text-sm"
                />
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Saving...
              </span>
            ) : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { href: '/profile/listings', icon: '📋', label: 'My Listings', desc: 'Manage your ads', accent: 'border-sky-200 hover:border-[#0EA5E9]' },
          { href: '/profile/favorites', icon: '❤️', label: 'Favorites', desc: 'Saved items', accent: 'border-pink-200 hover:border-pink-400' },
          { href: '/notifications', icon: '🔔', label: 'Notifications', desc: 'Platform updates', accent: 'border-green-200 hover:border-green-400' },
          { href: '/profile/subscription', icon: '🔔', label: 'Subscription', desc: 'Your listing plan', accent: 'border-purple-200 hover:border-purple-400' },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`bg-white rounded-2xl border ${item.accent} p-4 hover:shadow-md transition-all group interactive`}
          >
            <p className="text-2xl mb-1 group-hover:scale-110 transition-transform inline-block">{item.icon}</p>
            <p className="font-bold text-gray-900 text-sm">{item.label}</p>
            <p className="text-xs text-gray-400">{item.desc}</p>
          </Link>
        ))}
      </div>

      {/* My Listed Items */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <span className="w-2 h-5 bg-elite-gold rounded-full inline-block" />
            My Listed Items
          </h2>
          <Link
            href="/profile/listings"
            className="text-xs font-semibold text-elite-navy hover:text-elite-charcoal flex items-center gap-1 transition-colors"
          >
            View all
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {listingsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
            {[1,2,3].map(i => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[4/3] bg-gray-100 rounded-lg mb-2 shimmer" />
                <div className="h-3 bg-gray-100 rounded shimmer mb-1" />
                <div className="h-3 bg-gray-100 rounded shimmer w-2/3" />
              </div>
            ))}
          </div>
        ) : myListings.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
              {myListings.map((listing) => (
                <Link key={listing.id} href={`/listings/${listing.id}`} className="group block">
                  <div className="aspect-[4/3] relative overflow-hidden rounded-lg bg-gray-50 border border-gray-100 mb-2">
                    {listing.images?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveImageUrl(listing.images[0])}
                        alt={listing.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-3xl">🖼️</div>
                    )}
                    <span className={`absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      listing.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                      listing.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {listing.status}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-gray-900 line-clamp-1">{listing.title}</p>
                  <p className="text-xs text-elite-charcoal font-semibold">{listing.currency} {listing.price?.toLocaleString()}</p>
                </Link>
              ))}
            </div>
            {listingsTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 pb-4">
                <button
                  type="button"
                  disabled={listingsPage <= 1}
                  onClick={() => setListingsPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  Prev
                </button>
                <span className="text-xs text-gray-500">Page {listingsPage} of {listingsTotalPages}</span>
                <button
                  type="button"
                  disabled={listingsPage >= listingsTotalPages}
                  onClick={() => setListingsPage((p) => Math.min(listingsTotalPages, p + 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-5 px-4 text-center">
            <div className="w-14 h-14 bg-elite-gold/10 rounded-full flex items-center justify-center text-3xl mb-3">📦</div>
            <p className="font-semibold text-gray-700 mb-1">No listings yet</p>
            <p className="text-xs text-gray-400 mb-4">Start selling on 3R Elite marketplace</p>
            <Link
              href="/listings/create"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-elite-navy text-white text-xs font-bold rounded-xl hover:bg-elite-charcoal transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Post Your First Ad
            </Link>
          </div>
        )}
      </div>

      {/* ── CV, Certificates & Documents ─────────────────────────────────── */}
      <div id="cv-documents" className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mt-6 scroll-mt-24">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <span className="w-2 h-5 bg-sky-500 rounded-full inline-block" />
            CV, Certificates &amp; Documents
          </h2>
          <Link
            href="/jobs"
            className="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition-colors"
          >
            Browse Job Market →
          </Link>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          {/* Upload form */}
          <form onSubmit={handleDocUpload} className="bg-gray-50 rounded-2xl p-4 space-y-3 border border-gray-100">
            <h3 className="text-sm font-bold text-gray-800">Upload New Document</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Document Type</label>
                <select
                  value={docForm.type}
                  onChange={(e) => setDocForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  <option value="CV">📄 CV / Résumé</option>
                  <option value="CERTIFICATE">🏆 Certificate</option>
                  <option value="PORTFOLIO">🎨 Portfolio</option>
                  <option value="OTHER">📎 Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Title <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={docForm.title}
                  onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. My CV 2025"
                  maxLength={120}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="text"
                value={docForm.description}
                onChange={(e) => setDocForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Brief description of the document"
                maxLength={200}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">File <span className="text-red-500">*</span></label>
              <input
                ref={docFileRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                onChange={(e) => handleDocFileChange(e.target.files)}
                className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 transition-colors"
              />
              <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX, JPG, PNG — max 10 MB</p>
            </div>
            {docError && <p className="text-xs text-red-600">{docError}</p>}
            {docSuccess && <p className="text-xs text-emerald-600">{docSuccess}</p>}
            {selectedDocPreview && (
              <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3 text-xs text-gray-600">
                <p className="font-semibold text-gray-900 mb-2">Selected file preview</p>
                {/* Image preview for image files */}
                {selectedDocFile && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(selectedDocFile.type) && (
                  <div className="mb-2 overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedDocPreview}
                      alt="Document preview"
                      className="max-h-48 w-full object-contain"
                    />
                  </div>
                )}
                <p className="truncate font-medium">{selectedDocFile?.name}</p>
                <p className="text-[11px] text-gray-400">{selectedDocFile ? `${(selectedDocFile.size / 1024 / 1024).toFixed(2)} MB` : ''}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDocFile(null);
                      if (selectedDocPreview) {
                        URL.revokeObjectURL(selectedDocPreview);
                        setSelectedDocPreview(null);
                      }
                      if (docFileRef.current) docFileRef.current.value = '';
                    }}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Remove
                  </button>
                  <a
                    href={selectedDocPreview}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-sky-600 hover:text-sky-800"
                  >
                    Open in new tab
                  </a>
                </div>
              </div>
            )}
            <button
              type="submit"
              disabled={docUploading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              {docUploading ? 'Uploading…' : '⬆ Upload Document'}
            </button>
          </form>

          {/* Document list */}
          {docsLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-14 shimmer rounded-xl" />)}
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              <div className="text-3xl mb-2">📂</div>
              <p className="text-sm">No documents uploaded yet</p>
              <p className="text-xs mt-1">Upload your CV or certificates to appear in the job market.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-xl shrink-0">{doc.type === 'CV' ? '📄' : doc.type === 'CERTIFICATE' ? '🏆' : doc.type === 'PORTFOLIO' ? '🎨' : '📎'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-gray-500">{DOC_TYPE_LABELS[doc.type]}</span>
                      {doc.description && <span className="text-[10px] text-gray-400 truncate max-w-[150px]">{doc.description}</span>}
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${doc.isPublic ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                        {doc.isPublic ? '🌐 Public' : '🔒 Private'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(doc)}
                      className="text-xs text-sky-600 hover:text-sky-700 font-medium transition-colors"
                    >
                      👁 Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadUserDocument(doc.id, doc.fileName)}
                      className="text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors"
                    >
                      ⬇ Download
                    </button>
                    <button
                      onClick={() => handleDocDelete(doc.id)}
                      className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Document preview modal */}
      {previewDoc && (
        <DocPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  );
}
