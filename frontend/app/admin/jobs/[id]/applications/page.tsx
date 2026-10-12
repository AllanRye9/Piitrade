'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Application {
  id: string;
  documentId: string;
  cvTitle: string;
  coverNote: string | null;
  phone: string | null;
  status: 'SUBMITTED' | 'SHORTLISTED' | 'REJECTED';
  createdAt: string;
  applicant: { id: string; name: string | null; email: string; phone: string | null; country: string | null } | null;
}

const STATUS_STYLE: Record<Application['status'], string> = {
  SUBMITTED: 'bg-gray-100 text-gray-700',
  SHORTLISTED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

export default function JobApplicationsPage() {
  const params = useParams<{ id: string }>();
  const jobId = params?.id;
  const [job, setJob] = useState<{ title: string; company: string } | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!jobId) return;
    setLoading(true);
    api.get(`/jobs/${jobId}/applications`)
      .then(({ data }) => { setJob(data.job); setApplications(data.applications || []); setError(''); })
      .catch(() => setError('Could not load applications.'))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  // The CV file route is authenticated (bearer token), so fetch it as a blob
  // and open that — a plain link would arrive without credentials.
  const openCv = async (documentId: string) => {
    setBusyId(documentId);
    try {
      const { data } = await api.get(`/upload/documents/${documentId}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data as Blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Could not open that CV.');
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (id: string, status: Application['status']) => {
    setBusyId(id);
    try {
      await api.patch(`/jobs/applications/${id}`, { status });
      setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    } catch {
      setError('Could not update that application.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Link href="/admin/jobs" className="text-sm font-medium text-red-600 hover:underline">← Back to jobs</Link>
      <div>
        <h1 className="text-xl font-bold text-gray-900">Applications</h1>
        {job && <p className="text-sm text-gray-500">{job.title} · {job.company} · {applications.length} received</p>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && applications.length === 0 && !error && (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">No applications yet.</p>
      )}

      {applications.map((a) => (
        <div key={a.id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{a.applicant?.name || 'Applicant'}</p>
              <p className="text-xs text-gray-500">
                {a.applicant?.email}
                {(a.phone || a.applicant?.phone) ? ` · ${a.phone || a.applicant?.phone}` : ''}
                {a.applicant?.country ? ` · ${a.applicant.country}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">Applied {new Date(a.createdAt).toLocaleString()}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>
              {a.status === 'SUBMITTED' ? 'New' : a.status === 'SHORTLISTED' ? 'Shortlisted' : 'Rejected'}
            </span>
          </div>
          {a.coverNote && <p className="whitespace-pre-line rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{a.coverNote}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => openCv(a.documentId)} disabled={busyId === a.documentId}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              Open CV{a.cvTitle ? ` — ${a.cvTitle}` : ''}
            </button>
            {a.status !== 'SHORTLISTED' && (
              <button onClick={() => setStatus(a.id, 'SHORTLISTED')} disabled={busyId === a.id}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50">Shortlist</button>
            )}
            {a.status !== 'REJECTED' && (
              <button onClick={() => setStatus(a.id, 'REJECTED')} disabled={busyId === a.id}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 disabled:opacity-50">Reject</button>
            )}
            {a.applicant && (
              <Link href={`/messages?with=${a.applicant.id}&listing=none`} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600">Message</Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
