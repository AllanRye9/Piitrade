'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useAuth } from '@/context/AuthContext';
import { useDocumentFileUrl } from '@/hooks/useDocumentFileUrl';
import { downloadUserDocument } from '@/lib/documents';

interface UserDoc {
  id: string;
  type: 'CV' | 'CERTIFICATE' | 'PORTFOLIO' | 'OTHER';
  title: string;
  description?: string | null;
  fileUrl: string;
  fileName: string;
  fileSize?: number | null;
  createdAt: string;
}

interface Candidate {
  id: string;
  name: string;
  avatar?: string | null;
  country: string;
  cvThemeColor?: string | null;
  createdAt: string;
  documents: UserDoc[];
}

const DOC_ICONS: Record<string, string> = {
  CV: '📄',
  CERTIFICATE: '🏆',
  PORTFOLIO: '🎨',
  OTHER: '📎',
};

const COUNTRY_FLAGS: Record<string, string> = {
  UAE: '🇦🇪',
  UGANDA: '🇺🇬',
  KENYA: '🇰🇪',
  CHINA: '🇨🇳',
};

const DEFAULT_THEME = '#0EA5E9'; // sky-500

function extractResponseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } }).response?.status;
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocViewer({ doc, onClose }: { doc: UserDoc; onClose: () => void }) {
  const { url: fileUrl, loading: fileLoading } = useDocumentFileUrl(doc.id);
  const ext = doc.fileName.split('.').pop()?.toLowerCase() || '';
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
        <div className="flex items-center gap-3 p-4 border-b border-gray-100">
          <span className="text-2xl">{DOC_ICONS[doc.type] || '📎'}</span>
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
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
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
            <iframe src={fileUrl} className="w-full h-full min-h-[70vh]" title={doc.title} />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={doc.title} className="max-w-full mx-auto block p-4" />
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="text-6xl">{DOC_ICONS[doc.type] || '📎'}</div>
              <p className="text-gray-600 font-medium">{doc.fileName}</p>
              <button
                onClick={() => downloadUserDocument(doc.id, doc.fileName)}
                className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                Open / Download File
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CandidateProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ userId: string }>();
  const userId = params?.userId;
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewingDoc, setViewingDoc] = useState<UserDoc | null>(null);
  const [activeType, setActiveType] = useState<string>('ALL');

  // Page theme (from candidate's cvThemeColor or default sky-500)
  const themeColor = candidate?.cvThemeColor || DEFAULT_THEME;

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/auth/login?redirect=/jobs');
    }
  }, [authLoading, user, router]);

  const fetchCandidate = useCallback(async () => {
    if (!userId || !user) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/users/candidate/${userId}`);
      setCandidate(data.candidate);
      setError('');
    } catch (err: unknown) {
      const status = extractResponseStatus(err);
      setError(status === 401 ? 'Please sign in to view candidate profiles.' : 'Candidate profile not found.');
    } finally {
      setLoading(false);
    }
  }, [userId, user]);

  useEffect(() => {
    fetchCandidate();
  }, [fetchCandidate]);

  const docTypes = ['ALL', 'CV', 'CERTIFICATE', 'PORTFOLIO', 'OTHER'];
  const visibleDocs =
    activeType === 'ALL'
      ? candidate?.documents ?? []
      : (candidate?.documents ?? []).filter((d) => d.type === activeType);

  if (authLoading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-5 animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-48 bg-gray-200 rounded-3xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 bg-gray-200 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-5 text-center">
        <p className="text-5xl mb-4">🔍</p>
        <p className="font-bold text-gray-800 mb-2">Candidate not found</p>
        <Link href="/jobs" className="text-sky-600 hover:underline text-sm">
          ← Back to Job Market
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6 animate-fade-in">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Job Market', href: '/jobs' },
          { label: candidate.name },
        ]}
      />

      {/* Hero banner with candidate's chosen theme color */}
      <div
        className="rounded-3xl px-5 py-5 text-white shadow-xl mb-4 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${themeColor}dd 0%, ${themeColor} 100%)` }}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <UserAvatar
            user={{ id: candidate.id, name: candidate.name, avatar: candidate.avatar ?? undefined }}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{candidate.name}</h1>
            <p className="text-white/80 mt-1">
              {COUNTRY_FLAGS[candidate.country] || '🌍'} {candidate.country}
            </p>
            <p className="text-white/60 text-xs mt-1">
              Member since {new Date(candidate.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
            </p>
          </div>
          <a
            href="#candidate-documents"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/15 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-white/25"
          >
            📄 View Documents
          </a>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from(new Set(candidate.documents.map((d) => d.type))).map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 text-xs font-semibold text-white"
            >
              {DOC_ICONS[t]} {t}
            </span>
          ))}
        </div>
      </div>

      {/* Document type tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {docTypes.map((type) => {
          const count =
            type === 'ALL'
              ? candidate.documents.length
              : candidate.documents.filter((d) => d.type === type).length;
          if (type !== 'ALL' && count === 0) return null;
          return (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                activeType === type
                  ? 'text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-sky-400 hover:text-sky-600'
              }`}
              style={activeType === type ? { backgroundColor: themeColor } : {}}
            >
              {type !== 'ALL' && <span>{DOC_ICONS[type]}</span>}
              {type === 'ALL' ? '🗂️ All' : type}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeType === type ? 'bg-white/20' : 'bg-gray-100'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Documents grid */}
      <div id="candidate-documents" />
      {visibleDocs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
          <p className="text-gray-500 text-sm">No {activeType !== 'ALL' ? activeType.toLowerCase() : ''} documents available.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visibleDocs.map((doc) => {
            const fileSize = formatFileSize(doc.fileSize);
            return (
              <div
                key={doc.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                    style={{ backgroundColor: `${themeColor}18` }}
                  >
                    {DOC_ICONS[doc.type] || '📎'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{doc.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {doc.type}
                      {fileSize && <span> · {fileSize}</span>}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                {doc.description && (
                  <p className="text-xs text-gray-500 mb-3 line-clamp-2">{doc.description}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewingDoc(doc)}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:text-white"
                    style={{ borderColor: themeColor, color: themeColor }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = themeColor;
                      (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = '';
                      (e.currentTarget as HTMLButtonElement).style.color = themeColor;
                    }}
                  >
                    👁 View
                  </button>
                  <button
                    onClick={() => downloadUserDocument(doc.id, doc.fileName)}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
                    style={{ backgroundColor: themeColor }}
                  >
                    ⬇ Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Candidate CTA */}
      <div
        className="mt-5 rounded-2xl px-5 py-5 text-white text-center"
        style={{ background: `linear-gradient(135deg, ${themeColor}cc, ${themeColor})` }}
      >
        <h2 className="text-xl font-black mb-1">Interested in {candidate.name}?</h2>
        <p className="text-white/80 text-sm mb-4">Review public CVs, certificates, and portfolio files to shortlist this candidate.</p>
        <a
          href="#candidate-documents"
          className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 text-sm font-bold transition-all hover:opacity-90"
          style={{ color: themeColor }}
        >
          📄 Browse Documents
        </a>
      </div>

      {/* Modals */}
      {viewingDoc && (
        <DocViewer doc={viewingDoc} onClose={() => setViewingDoc(null)} />
      )}
    </div>
  );
}
