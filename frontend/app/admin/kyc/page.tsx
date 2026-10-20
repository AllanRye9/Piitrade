'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { formatDate, timeAgo } from '@/lib/utils';
import { KycImage } from '@/components/ui/KycImage';

type StatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED';
type DocumentType = 'NATIONAL_ID' | 'PASSPORT' | 'DRIVERS_LICENSE' | 'BUSINESS_LICENSE';

interface KycUser {
  id: string;
  name: string;
  email: string;
  role: string;
  country: string;
  kycStatus: StatusFilter | 'NOT_SUBMITTED';
  kycDocumentType?: DocumentType | null;
  kycDocumentUrl?: string | null;
  // Only populated for two-sided document types (national ID, driver's
  // licence) — see TWO_SIDED_DOCUMENT_TYPES in backend/src/routes/kyc.ts.
  kycDocumentBackUrl?: string | null;
  kycSelfieUrl?: string | null;
  kycFullName?: string | null;
  kycPurpose?: string | null;
  kycBusinessName?: string | null;
  kycBusinessRegNumber?: string | null;
  kycPhone?: string | null;
  kycAddress?: string | null;
  kycSubmittedAt?: string | null;
  kycReviewedAt?: string | null;
  kycRejectionReason?: string | null;
  isKycVerified: boolean;
}

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  NATIONAL_ID: 'National ID Card',
  PASSPORT: 'Passport',
  DRIVERS_LICENSE: "Driver's License",
  BUSINESS_LICENSE: 'Business License',
};

function getApiErrorMessage(err: unknown): string {
  return (
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    'An error occurred'
  );
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700',
    NOT_SUBMITTED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles[status] || styles.NOT_SUBMITTED}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

export default function AdminKycPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [submissions, setSubmissions] = useState<KycUser[]>([]);
  const [fetching, setFetching] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('PENDING');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  const fetchSubmissions = useCallback(async () => {
    try {
      setFetching(true);
      const { data } = await api.get('/admin/kyc', { params: { status, page, limit } });
      setSubmissions(data.users);
      setTotal(data.pagination.total);
    } catch {
      // ignore
    } finally {
      setFetching(false);
    }
  }, [status, page]);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'ADMIN') fetchSubmissions();
  }, [user, fetchSubmissions]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await api.put(`/admin/kyc/${id}/approve`);
      await fetchSubmissions();
    } catch (err: unknown) {
      alert(getApiErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    setActionLoading(rejectTarget);
    try {
      await api.put(`/admin/kyc/${rejectTarget}/reject`, { reason: rejectReason.trim() });
      await fetchSubmissions();
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: unknown) {
      alert(getApiErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / limit);

  if (loading || fetching) return <div className="p-8 text-center">Loading…</div>;

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">KYC Verification Queue</h1>
      <p className="text-gray-500 mb-6">
        Review seller identity documents. Approving grants a &quot;KYC Verified&quot; badge, priority
        listing-approval, and higher search placement.
        {status === 'PENDING' && total > 0 && (
          <span className="ml-1 font-medium text-yellow-600">({total} pending)</span>
        )}
      </p>

      {/* Status tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['PENDING', 'APPROVED', 'REJECTED'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              status === s
                ? 'bg-red-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-red-300'
            }`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
            {status === s && total > 0 && <span className="ml-1.5 opacity-80">({total})</span>}
          </button>
        ))}
      </div>

      {submissions.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-6 text-center">
          <p className="text-4xl mb-3">🪪</p>
          <p className="text-gray-500">No {status.toLowerCase()} KYC submissions.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((s) => (
            <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              {/* Header row */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900">{s.name}</span>
                    <span className="text-gray-400 text-xs">{s.email}</span>
                    <span className="text-gray-400 text-xs">· {s.role} · {s.country}</span>
                    {statusBadge(s.kycStatus)}
                  </div>
                  <p className="text-xs text-gray-500">
                    Submitted name: <span className="font-medium text-gray-700">{s.kycFullName || '—'}</span>
                    {' · '}
                    {s.kycDocumentType ? DOCUMENT_LABELS[s.kycDocumentType] : 'No document type'}
                  </p>
                  {s.kycPurpose && s.kycPurpose !== 'PERSONAL' && (
                    <div className="mt-1 rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900">
                      <p className="font-bold">{s.kycPurpose === 'WEBSTORE' ? 'Webstore' : 'Partner'} verification</p>
                      <p>{s.kycBusinessName}{s.kycBusinessRegNumber ? ` · Reg. ${s.kycBusinessRegNumber}` : ' · no registration number'}</p>
                      <p>{s.kycPhone} · {s.kycAddress}</p>
                    </div>
                  )}
                  {s.kycSubmittedAt && (
                    <span className="text-xs text-gray-400">{timeAgo(s.kycSubmittedAt)} · {formatDate(s.kycSubmittedAt)}</span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 shrink-0">
                  {s.kycStatus === 'PENDING' && (
                    <>
                      <button
                        onClick={() => handleApprove(s.id)}
                        disabled={actionLoading === s.id}
                        className="px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => setRejectTarget(s.id)}
                        disabled={actionLoading === s.id}
                        className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium transition-colors"
                  >
                    {expanded === s.id ? 'Collapse' : 'View Documents'}
                  </button>
                </div>
              </div>

              {/* Expanded documents */}
              {expanded === s.id && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                  <div className="flex gap-3 flex-wrap">
                    {s.kycDocumentUrl && (
                      <KycImage url={s.kycDocumentUrl} alt="ID document front" caption={s.kycDocumentBackUrl ? 'Document — Front' : 'Document'} className="h-40 rounded-lg border border-gray-200 object-cover" />
                    )}
                    {s.kycDocumentBackUrl && (
                      <KycImage url={s.kycDocumentBackUrl} alt="ID document back" caption="Document — Back" className="h-40 rounded-lg border border-gray-200 object-cover" />
                    )}
                    {s.kycSelfieUrl && (
                      <KycImage url={s.kycSelfieUrl} alt="Selfie" caption="Selfie" className="h-40 rounded-lg border border-gray-200 object-cover" />
                    )}
                    {!s.kycDocumentUrl && !s.kycSelfieUrl && (
                      <p className="text-xs text-gray-400">No documents on file.</p>
                    )}
                  </div>
                  {s.kycRejectionReason && (
                    <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                      <span className="font-semibold">Rejection reason:</span> {s.kycRejectionReason}
                    </p>
                  )}
                  {s.kycReviewedAt && (
                    <p className="text-xs text-gray-400">Reviewed {formatDate(s.kycReviewedAt)}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      {/* Reject modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Reject KYC Submission</h2>
            <p className="text-sm text-gray-500 mb-4">
              Explain what&apos;s wrong so the seller can correct it and resubmit. This reason is shown to them.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="e.g. Document photo is blurry, please resubmit"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={!!actionLoading || !rejectReason.trim()}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Rejecting…' : 'Reject Submission'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
