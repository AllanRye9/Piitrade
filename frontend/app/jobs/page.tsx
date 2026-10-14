'use client';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { resolveImageUrl } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { T } from '@/components/ui/T';
import { useTr } from '@/lib/i18n/useTr';

/**
 * /jobs — the public job board.
 *
 * Deliberately CV-free: nobody's CV or candidate profile is listed or
 * previewed here. A CV is only ever sent as part of an application (the Apply
 * dialog below), and only that job's poster / an admin can open it.
 */

function extractResponseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } }).response?.status;
}

function extractMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { message?: string } } }).response?.data?.message || fallback;
}

interface JobPost {
  id: string;
  title: string;
  company: string;
  location: string;
  type: string;
  category: string;
  qualification: string;
  description: string;
  salary?: string | null;
  deadline?: string | null;
  imageUrl?: string | null;
  country: string;
  status: 'ACTIVE' | 'CLOSED' | 'DRAFT';
  createdAt: string;
}

interface JobMeta {
  categories: string[];
  types: string[];
  qualifications: string[];
  countries: string[];
}

interface MyCv {
  id: string;
  title: string;
  fileName: string;
  createdAt: string;
}

const DEFAULT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Freelance', 'Internship', 'Temporary'];
const DEFAULT_COUNTRIES = ['UGANDA'];
const COUNTRY_LABELS: Record<string, string> = { UGANDA: 'Uganda' };

function normalizeEmploymentType(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  const mapped: Record<string, string> = {
    'full-time': 'Full-time',
    'full time': 'Full-time',
    'part-time': 'Part-time',
    'part time': 'Part-time',
    contract: 'Contract',
    freelance: 'Freelance',
    internship: 'Internship',
    temporary: 'Temporary',
  };
  return mapped[value] ?? null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

function truncate(text: string, max = 160) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}

function CompanyMark({ job, size = 'md' }: { job: JobPost; size?: 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const dims = size === 'lg' ? 'h-16 w-16 text-xl' : 'h-12 w-12 text-base';
  const initials = job.company.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  if (job.imageUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolveImageUrl(job.imageUrl)}
        alt={`${job.company} logo`}
        onError={() => setBroken(true)}
        className={`${dims} shrink-0 rounded-xl border border-gray-200 bg-white object-contain p-0.5`}
      />
    );
  }
  return (
    <div className={`${dims} flex shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 font-bold text-gray-600`} aria-hidden="true">
      {initials}
    </div>
  );
}

function ShareJobButtons({ job }: { job: JobPost }) {
  const tr = useTr();
  const [copied, setCopied] = useState(false);
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com');
  const pageUrl = `${siteUrl}/jobs`;
  const text = `${job.title} at ${job.company}${job.location ? ` — ${job.location}` : ''}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${text} — ${pageUrl}`)}`;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-gray-400 font-medium mr-0.5"><T>Share:</T></span>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={tr("Share on X (Twitter)")}
        className="w-7 h-7 rounded-lg bg-gray-900 hover:bg-black flex items-center justify-center text-white transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
      <a
        href={linkedinUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={tr("Share on LinkedIn")}
        className="w-7 h-7 rounded-lg bg-[#0077B5] hover:bg-[#005f94] flex items-center justify-center text-white transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      </a>
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={tr("Share on WhatsApp")}
        className="w-7 h-7 rounded-lg bg-[#25D366] hover:bg-[#1ebe57] flex items-center justify-center text-white transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>
      <button
        onClick={copyLink}
        title={tr("Copy link")}
        className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors"
      >
        {copied ? (
          <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100';

function Chip({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'red' | 'green' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    red: 'bg-red-50 text-red-700',
    green: 'bg-emerald-50 text-emerald-700',
  } as const;
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

/* ───────────────────────── Apply dialog ───────────────────────── */

function ApplyPanel({
  job, onApplied,
}: { job: JobPost; onApplied: (jobId: string) => void }) {
  const tr = useTr();
  const { user, loading: authLoading } = useAuth();
  const [cvs, setCvs] = useState<MyCv[]>([]);
  const [loadingCvs, setLoadingCvs] = useState(false);
  const [cvId, setCvId] = useState('');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadingCvs(true);
    api.get('/upload/documents')
      .then(({ data }) => {
        if (!active) return;
        const mine: MyCv[] = (data.documents || []).filter((d: { type: string }) => d.type === 'CV');
        setCvs(mine);
        if (mine.length === 1) setCvId(mine[0].id);
      })
      .catch(() => { if (active) setError('Could not load your CVs. Please try again.'); })
      .finally(() => { if (active) setLoadingCvs(false); });
    return () => { active = false; };
  }, [user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cvId) { setError('Please choose the CV to send with your application.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/jobs/${job.id}/apply`, { documentId: cvId, coverNote: note, phone });
      setDone(true);
      onApplied(job.id);
    } catch (err: unknown) {
      const status = extractResponseStatus(err);
      if (status === 409) { setDone(true); onApplied(job.id); return; }
      setError(extractMessage(err, 'Could not send your application. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) return <div className="h-24 animate-pulse rounded-xl bg-gray-100" />;

  if (!user) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-center">
        <p className="text-sm font-semibold text-gray-900"><T>Sign in to apply</T></p>
        <p className="mt-1 text-sm text-gray-600"><T>Your CV is shared with the recruiter only when you submit an application.</T></p>
        <Link href="/auth/login" className="mt-4 inline-flex rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
          <T>Sign in</T>
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <p className="text-sm font-semibold text-emerald-800"><T>Application sent</T></p>
        <p className="mt-1 text-sm text-emerald-700">The recruiter at {job.company} can now review your CV. You will be notified of any update.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900"><T>Your CV</T></p>
        <p className="mt-0.5 text-xs text-gray-500">Only {job.company} (the recruiter for this job) will be able to open it.</p>
        {loadingCvs ? (
          <div className="mt-2 h-14 animate-pulse rounded-lg bg-gray-100" />
        ) : cvs.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">
            You have no CV on your account yet.{' '}
            <Link href="/profile#cv-documents" className="font-semibold text-red-600 hover:underline"><T>Upload one</T></Link>
            {' '}or{' '}
            <Link href="/cv-generator" className="font-semibold text-red-600 hover:underline"><T>build one</T></Link>
            , then come back to apply.
          </div>
        ) : (
          <div className="mt-2 space-y-2" role="radiogroup" aria-label={tr("Choose a CV")}>
            {cvs.map((cv) => (
              <label key={cv.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${cvId === cv.id ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="radio" name="cv" value={cv.id} checked={cvId === cv.id} onChange={() => setCvId(cv.id)} className="h-4 w-4 accent-red-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-900">{cv.title}</span>
                  <span className="block truncate text-xs text-gray-500">{cv.fileName}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="apply-note" className="text-sm font-semibold text-gray-900"><T>Cover note</T> <span className="font-normal text-gray-500">(optional)</span></label>
        <textarea id="apply-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000}
          placeholder={tr("Briefly introduce yourself and why you are a good fit.")} className={`${inputCls} mt-1.5 resize-y`} />
      </div>

      <div>
        <label htmlFor="apply-phone" className="text-sm font-semibold text-gray-900"><T>Phone</T> <span className="font-normal text-gray-500">(optional)</span></label>
        <input id="apply-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel"
          placeholder={tr("Best number to reach you")} className={`${inputCls} mt-1.5`} />
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={submitting || loadingCvs || cvs.length === 0}
        className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
        {submitting ? 'Sending…' : 'Submit application'}
      </button>
    </form>
  );
}

/* ───────────────────────── Job detail dialog ───────────────────────── */

function JobDialog({
  job, applied, onClose, onApplied,
}: { job: JobPost; applied: boolean; onClose: () => void; onApplied: (jobId: string) => void }) {
  const tr = useTr();
  const [showApply, setShowApply] = useState(false);
  const [posterBroken, setPosterBroken] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const facts = [
    { label: 'Employment type', value: job.type },
    { label: 'Category', value: job.category },
    { label: 'Qualification', value: job.qualification },
    { label: 'Country', value: COUNTRY_LABELS[job.country] || job.country },
    { label: 'Salary', value: job.salary || 'Not specified' },
    { label: 'Deadline', value: job.deadline || 'Open until filled' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="job-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start gap-4 border-b border-gray-200 p-5">
          <CompanyMark job={job} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id="job-dialog-title" className="text-lg font-bold leading-snug text-gray-900 sm:text-xl">{job.title}</h2>
            <p className="mt-0.5 text-sm text-gray-600">{job.company}{job.location ? ` · ${job.location}` : ''}</p>
            <p className="mt-1 text-xs text-gray-500">Posted {timeAgo(job.createdAt)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tr("Close")}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {job.imageUrl && !posterBroken && (
            <a href={resolveImageUrl(job.imageUrl)} target="_blank" rel="noopener noreferrer"
              className="mb-5 block overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resolveImageUrl(job.imageUrl)} alt={`${job.title} at ${job.company}`}
                onError={() => setPosterBroken(true)}
                className="mx-auto max-h-[60vh] w-full object-contain" />
            </a>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{f.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-gray-900">{f.value}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-6 text-sm font-bold text-gray-900"><T>About the role</T></h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">{job.description}</p>

          <div className="mt-6 border-t border-gray-200 pt-5">
            {applied ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                <T>You have applied for this job.</T>
              </div>
            ) : showApply ? (
              <>
                <h3 className="mb-3 text-sm font-bold text-gray-900"><T>Apply for this job</T></h3>
                <ApplyPanel job={job} onApplied={onApplied} />
              </>
            ) : (
              <button type="button" onClick={() => setShowApply(true)}
                className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 sm:w-auto sm:px-10">
                <T>Apply now</T>
              </button>
            )}
          </div>

          <div className="mt-5"><ShareJobButtons job={job} /></div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Board ───────────────────────── */

function JobsBoard() {
  const tr = useTr();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [meta, setMeta] = useState<JobMeta | null>(null);
  const [jobs, setJobs] = useState<JobPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<JobPost | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [place, setPlace] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchLocation, setSearchLocation] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterCountry, setFilterCountry] = useState('');

  useEffect(() => {
    api.get('/jobs/meta').then(({ data }) => setMeta(data)).catch(() => {});
  }, []);

  // Seed filters from the URL (header search / category links).
  useEffect(() => {
    if (!searchParams) return;
    const q = searchParams.get('q') || '';
    setKeyword(q);
    setSearchQ(q);
    setFilterType(normalizeEmploymentType(searchParams.get('employmentType') || searchParams.get('type') || '') || '');
    setFilterCat(searchParams.get('industry') || searchParams.get('category') || '');
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ limit: '200', status: 'ACTIVE' });
    if (filterType) params.set('employmentType', filterType);
    if (filterCat) params.set('industry', filterCat);
    if (filterCountry) params.set('country', filterCountry);
    if (searchLocation) params.set('location', searchLocation);
    if (searchQ) params.set('q', searchQ);
    api.get(`/jobs?${params.toString()}`)
      .then(({ data }) => {
        if (!active) return;
        setJobs((data.jobs || []).filter((j: JobPost) => !j.status || j.status === 'ACTIVE'));
        setError('');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setJobs([]);
        setError(extractResponseStatus(err) === 401 ? 'Please sign in to view job listings.' : 'Could not load job listings right now.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filterType, filterCat, filterCountry, searchLocation, searchQ]);

  // Which jobs has this user already applied to?
  useEffect(() => {
    if (!user) { setAppliedIds(new Set()); return; }
    api.get('/jobs/applications/mine')
      .then(({ data }) => setAppliedIds(new Set((data.applications || []).map((a: { jobId: string }) => a.jobId))))
      .catch(() => {});
  }, [user]);

  const types = meta?.types?.length ? meta.types : DEFAULT_TYPES;
  const countries = meta?.countries?.length ? meta.countries : DEFAULT_COUNTRIES;
  const categories = useMemo(
    () => (meta?.categories?.length ? meta.categories : Array.from(new Set(jobs.map((j) => j.category).filter(Boolean)))),
    [meta?.categories, jobs],
  );

  const activeFilters = [
    filterType && { key: 'type', label: filterType, clear: () => setFilterType('') },
    filterCat && { key: 'cat', label: filterCat, clear: () => setFilterCat('') },
    filterCountry && { key: 'country', label: COUNTRY_LABELS[filterCountry] || filterCountry, clear: () => setFilterCountry('') },
    searchLocation && { key: 'loc', label: `Location: ${searchLocation}`, clear: () => { setSearchLocation(''); setPlace(''); } },
    searchQ && { key: 'q', label: `“${searchQ}”`, clear: () => { setSearchQ(''); setKeyword(''); } },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const clearAll = () => {
    setFilterType(''); setFilterCat(''); setFilterCountry('');
    setSearchLocation(''); setPlace(''); setSearchQ(''); setKeyword('');
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQ(keyword.trim());
    setSearchLocation(place.trim());
  };

  const markApplied = useCallback((jobId: string) => {
    setAppliedIds((prev) => new Set(prev).add(jobId));
  }, []);

  const filterPanel = (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-gray-900"><T>Employment type</T></legend>
        <div className="space-y-1.5">
          {types.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-700">
              <input type="radio" name="employment-type" checked={filterType === t}
                onChange={() => setFilterType(filterType === t ? '' : t)}
                onClick={() => { if (filterType === t) setFilterType(''); }}
                className="h-4 w-4 accent-red-600" />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="f-cat" className="mb-2 block text-sm font-semibold text-gray-900"><T>Category</T></label>
        <select id="f-cat" value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className={inputCls}>
          <option value=""><T>All categories</T></option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {activeFilters.length > 0 && (
        <button type="button" onClick={clearAll} className="text-sm font-semibold text-red-600 hover:underline"><T>Clear all filters</T></button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:py-4">
      <Breadcrumb className="mb-4" items={[{ label: 'Home', href: '/' }, { label: 'Jobs' }]} />

      <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl"><T>Find your next job</T></h1>
        <p className="mt-1 text-sm text-gray-600"><T>Browse open positions across Uganda, and apply in minutes.</T></p>
        <form onSubmit={onSearch} role="search" className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label htmlFor="jobs-keyword" className="sr-only"><T>Job title, company or keyword</T></label>
            <input id="jobs-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder={tr("Job title, company or keyword")} className={`${inputCls} py-3`} />
          </div>
          <div>
            <label htmlFor="jobs-location" className="sr-only"><T>Location</T></label>
            <input id="jobs-location" value={place} onChange={(e) => setPlace(e.target.value)}
              placeholder={tr("City or location")} className={`${inputCls} py-3`} />
          </div>
          <button type="submit" className="rounded-lg bg-red-600 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700">
            <T>Search jobs</T>
          </button>
        </form>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Filters — sidebar on desktop, collapsible on mobile */}
        <aside>
          <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}
            className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 lg:hidden">
            <span>Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}</span>
            <svg className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          <div className={`${filtersOpen ? 'mt-3 block' : 'hidden'} rounded-xl border border-gray-200 bg-white p-5 lg:sticky lg:top-24 lg:mt-0 lg:block`}>
            {filterPanel}
          </div>
        </aside>

        {/* Results */}
        <section aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">
              {loading ? 'Loading jobs…' : `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} found`}
            </p>
            {activeFilters.map((f) => (
              <button key={f.key} type="button" onClick={f.clear}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">
                {f.label}<span aria-hidden="true">×</span><span className="sr-only"><T>Remove filter</T></span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse rounded-xl border border-gray-200 bg-white p-5">
                  <div className="flex gap-4"><div className="h-12 w-12 rounded-xl bg-gray-200" /><div className="flex-1 space-y-2"><div className="h-4 w-1/2 rounded bg-gray-200" /><div className="h-3 w-1/3 rounded bg-gray-100" /><div className="h-3 w-3/4 rounded bg-gray-100" /></div></div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">{error}</div>
          ) : jobs.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
              <p className="text-base font-semibold text-gray-900"><T>No jobs match your search</T></p>
              <p className="mt-1 text-sm text-gray-600"><T>Try different keywords or remove some filters.</T></p>
              {activeFilters.length > 0 && (
                <button type="button" onClick={clearAll} className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><T>Clear all filters</T></button>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {jobs.map((job) => {
                const applied = appliedIds.has(job.id);
                return (
                  <li key={job.id} id={`job-${job.id}`}>
                    <article className="rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md sm:p-5">
                      <div className="flex gap-4">
                        <CompanyMark job={job} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h2 className="text-base font-bold leading-snug text-gray-900">
                                <button type="button" onClick={() => setSelected(job)} className="text-left hover:text-red-700 focus:outline-none focus-visible:underline">
                                  {job.title}
                                </button>
                              </h2>
                              <p className="mt-0.5 text-sm text-gray-600">{job.company}{job.location ? ` · ${job.location}` : ''}</p>
                            </div>
                            <span className="shrink-0 text-xs text-gray-500">{timeAgo(job.createdAt)}</span>
                          </div>
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <Chip tone="red">{job.type}</Chip>
                            <Chip>{job.category}</Chip>
                            <Chip>{job.qualification}</Chip>
                            {job.salary && <Chip tone="green">{job.salary}</Chip>}
                          </div>
                          <p className="mt-2.5 text-sm leading-relaxed text-gray-600">{truncate(job.description)}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => setSelected(job)}
                              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                              <T>View details</T>
                            </button>
                            {applied ? (
                              <span className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700"><T>Applied</T></span>
                            ) : (
                              <button type="button" onClick={() => setSelected(job)}
                                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                                <T>Apply</T>
                              </button>
                            )}
                            {job.deadline && <span className="text-xs text-gray-500">Deadline: {job.deadline}</span>}
                          </div>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {selected && (
        <JobDialog job={selected} applied={appliedIds.has(selected.id)} onClose={() => setSelected(null)} onApplied={markApplied} />
      )}
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-red-200 border-t-red-500" /></div>}>
      <JobsBoard />
    </Suspense>
  );
}
