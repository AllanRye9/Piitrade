'use client';

import { useState, useEffect, useCallback, useMemo, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { resolveImageUrl } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useDocumentFileUrl } from '@/hooks/useDocumentFileUrl';
import { downloadUserDocument } from '@/lib/documents';

function extractResponseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } }).response?.status;
}

interface UserDoc {
  id: string;
  type: 'CV' | 'CERTIFICATE' | 'PORTFOLIO' | 'OTHER';
  title: string;
  description?: string | null;
  fileUrl: string;
  fileName: string;
  createdAt: string;
}

interface Candidate {
  id: string;
  name: string;
  avatar?: string | null;
  country: string;
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

type DocTypeFilter = 'ALL' | 'CV' | 'CERTIFICATE' | 'PORTFOLIO' | 'OTHER';

interface PreviewModal {
  candidate: Candidate;
  doc: UserDoc;
}

function DocPreviewModal({ preview, onClose }: { preview: PreviewModal; onClose: () => void }) {
  const { candidate, doc } = preview;
  const { url: fileUrl, loading: fileLoading } = useDocumentFileUrl(doc.id);
  const ext = doc.fileName.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  // Word docs can't be inline-previewed here: doing so used to mean handing
  // the file's URL to Microsoft's public embed service, which isn't
  // appropriate now that document files require authentication to fetch
  // (and wasn't really appropriate for private CVs even before). Word docs
  // fall through to the download fallback below instead.

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-100">
          <UserAvatar user={{ id: candidate.id, name: candidate.name, avatar: candidate.avatar ?? undefined }} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-sm truncate">{candidate.name}</p>
            <p className="text-xs text-gray-500">{doc.title} · {DOC_ICONS[doc.type]} {doc.type}</p>
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

        {/* Content */}
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
              className="w-full h-full min-h-[60vh]"
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

function CvThumbnail({ doc, onClick }: { doc: UserDoc; onClick: () => void }) {
  const { url: fileUrl } = useDocumentFileUrl(doc.id);
  const ext = doc.fileName.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);

  return (
    <button
      onClick={onClick}
      className="group relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-gray-100 bg-gray-50 mb-3 block"
      aria-label={`Preview ${doc.title}`}
    >
      {isImage && fileUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl} alt={doc.title} className="w-full h-full object-cover object-top" />
      ) : isPdf && fileUrl ? (
        // Scaled-down PDF render used purely as a thumbnail — interaction
        // is disabled so clicks fall through to the button's onClick.
        <iframe src={`${fileUrl}#toolbar=0`} className="w-full h-full pointer-events-none" title={doc.title} />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-sky-50 to-gray-100">
          <span className="text-3xl">{DOC_ICONS[doc.type] || '📄'}</span>
          <span className="text-[10px] font-medium text-gray-400 px-2 truncate max-w-full">{doc.fileName}</span>
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
        <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-semibold bg-black/60 px-3 py-1.5 rounded-lg transition-opacity">
          👁 View CV
        </span>
      </div>
    </button>
  );
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

const JOB_IMAGE_FALLBACK = '/apple-touch-icon.svg';
const JOB_DESCRIPTION_PREVIEW_LENGTH = 140;

function truncateJobDescription(description: string) {
  if (description.length <= JOB_DESCRIPTION_PREVIEW_LENGTH) return description;
  return `${description.slice(0, JOB_DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…`;
}

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

function formatJobDetails(job: JobPost) {
  return [
    { label: 'Company', value: job.company },
    { label: 'Location', value: job.location || 'Remote / not specified' },
    { label: 'Country', value: job.country },
    { label: 'Employment type', value: job.type },
    { label: 'Category', value: job.category },
    { label: 'Qualification', value: job.qualification },
    { label: 'Salary', value: job.salary || 'Not specified' },
    { label: 'Deadline', value: job.deadline || 'Open until filled' },
  ];
}

function ShareJobButtons({ job }: { job: JobPost }) {
  const [copied, setCopied] = useState(false);
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || 'https://3r-elite.com');
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
      <span className="text-[10px] text-gray-400 font-medium mr-0.5">Share:</span>
      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Share on X (Twitter)"
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
        title="Share on LinkedIn"
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
        title="Share on WhatsApp"
        className="w-7 h-7 rounded-lg bg-[#25D366] hover:bg-[#1ebe57] flex items-center justify-center text-white transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>
      <button
        onClick={copyLink}
        title="Copy link"
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

function JobsBoard({ meta }: { meta: JobMeta | null }) {
  const searchParams = useSearchParams();
  const sectionRef = useRef<HTMLElement>(null);
  const [jobs, setJobs] = useState<JobPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobsError, setJobsError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQ, setSearchQ] = useState('');

  const scrollToSection = () => {
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (!searchParams) return;
    const queryValue = searchParams.get('q') || '';
    const typeValue = normalizeEmploymentType(searchParams.get('employmentType') || searchParams.get('type') || '') || '';
    const categoryValue = searchParams.get('industry') || searchParams.get('category') || '';

    setFilterType(typeValue);
    setFilterCat(categoryValue);
    setSearchInput(queryValue);
    setSearchQ(queryValue);
  }, [searchParams]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '500', status: 'ACTIVE' });
    if (filterType) params.set('employmentType', filterType);
    if (filterCat) params.set('industry', filterCat);
    if (filterCountry) params.set('country', filterCountry);
    if (filterRole) params.set('role', filterRole);
    if (filterLocation) params.set('location', filterLocation);
    if (searchQ) params.set('q', searchQ);
    api.get(`/jobs?${params.toString()}`)
      .then(({ data }) => {
        // Defensive: only ever show jobs that are actually open, regardless
        // of what the API returns for the current user's role.
        const openJobs = (data.jobs || []).filter((j: JobPost) => !j.status || j.status === 'ACTIVE');
        setJobs(openJobs);
        setJobsError('');
      })
      .catch((err: unknown) => {
        const status = extractResponseStatus(err);
        setJobs([]);
        setJobsError(status === 401 ? 'Please sign in to view job listings.' : 'Could not load job listings right now.');
      })
      .finally(() => setLoading(false));
  }, [filterType, filterCat, filterCountry, filterRole, filterLocation, searchQ]);

  const jobTypes = useMemo(
    () => meta?.types?.length
      ? meta.types
      : ['Full-time', 'Part-time', 'Contract', 'Freelance', 'Internship', 'Temporary'],
    [meta?.types],
  );

  const jobCategories = useMemo(() => {
    const dynamicCategories = meta?.categories?.filter(Boolean) ?? [];
    if (dynamicCategories.length) return dynamicCategories;

    const uniqueCategories = Array.from(
      new Set(jobs.map((job) => job.category?.trim() || 'Other').filter(Boolean)),
    );

    return uniqueCategories.length > 0
      ? uniqueCategories
      : [
          'Technology',
          'Finance',
          'Healthcare',
          'Education',
          'Engineering',
          'Sales & Marketing',
          'Admin & Support',
          'Design & Creative',
          'Legal',
          'Logistics & Transport',
          'Hospitality',
          'Construction',
          'Other',
        ];
  }, [meta?.categories, jobs]);

  const countriesList = useMemo(
    () => meta?.countries?.length
      ? meta.countries
      : ['UAE', 'UGANDA', 'KENYA', 'CHINA'],
    [meta?.countries],
  );

  const quickTypeFilters = [
    { label: 'Full Time', value: 'Full-time' },
    { label: 'Part Time', value: 'Part-time' },
    { label: 'Freelance', value: 'Freelance' },
  ];

  const quickIndustryFilters = ['Technology', 'Healthcare', 'Finance'];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQ(searchInput.trim());
  };

  if (!loading && jobs.length === 0 && !filterCat && !filterType && !filterCountry && !searchQ) return null;

  return (
    <section ref={sectionRef} className="mt-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Open Jobs</h2>
          <p className="mt-0.5 text-sm text-gray-500">{jobs.length} available {filterType ? `· ${filterType}` : ''}{filterCat ? ` · ${filterCat}` : ''}</p>
        </div>
      </div>

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-500">Employment</span>
          {quickTypeFilters.map((filter) => (
            <button
              type="button"
              key={filter.value}
              onClick={() => { setFilterType((current) => (current === filter.value ? '' : filter.value)); scrollToSection(); }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${filterType === filter.value ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-sky-50'}`}
            >
              {filter.label}
            </button>
          ))}
          {filterType && (
            <button
              type="button"
              onClick={() => setFilterType('')}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear type
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-500">Industries</span>
          {quickIndustryFilters.map((industry) => (
            <button
              type="button"
              key={industry}
              onClick={() => { setFilterCat((current) => (current === industry ? '' : industry)); scrollToSection(); }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${filterCat === industry ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-purple-50'}`}
            >
              {industry}
            </button>
          ))}
          {filterCat && (
            <button
              type="button"
              onClick={() => setFilterCat('')}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear industry
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSearch} className="mb-3 flex gap-2" role="search">
        <label htmlFor="jobs-search" className="sr-only">Search jobs by title, company or keyword</label>
        <input
          id="jobs-search"
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search jobs by title, company or keyword…"
          aria-label="Search jobs by title, company or keyword"
          className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        <button type="submit" aria-label="Submit job search" className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700">
          Search
        </button>
        {searchQ && (
          <button type="button" onClick={() => { setSearchInput(''); setSearchQ(''); }} aria-label="Clear search" className="rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50">
            Clear
          </button>
        )}
      </form>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <select
          value={filterCountry}
          onChange={(e) => setFilterCountry(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          <option value="">All Countries</option>
          {countriesList.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          <option value="">All Types</option>
          {jobTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <input
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          placeholder="Role"
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        <input
          value={filterLocation}
          onChange={(e) => setFilterLocation(e.target.value)}
          placeholder="Location"
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          <option value="">All Categories</option>
          {jobCategories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        {(filterCat || filterType || filterCountry || filterRole || filterLocation) && (
          <button
            type="button"
            onClick={() => { setFilterCat(''); setFilterType(''); setFilterCountry(''); setFilterRole(''); setFilterLocation(''); }}
            className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
          >
            × Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-gray-100 bg-white p-4">
              <div className="flex gap-4">
                <div className="h-11 w-11 shrink-0 rounded-xl bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 rounded bg-gray-200" />
                  <div className="h-3 w-1/3 rounded bg-gray-100" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {jobsError ? (
            <div className="rounded-2xl border border-red-100 bg-white p-6 text-center text-sm text-red-500">
              {jobsError}
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-400">
              No jobs match your filters.
            </div>
          ) : jobs.map((job) => {
            const isExpanded = expanded === job.id;
            const previewText = truncateJobDescription(job.description);
            const hasReadMore = previewText !== job.description || Boolean(job.deadline || job.salary);

            return (
              <div id={`job-${job.id}`} key={job.id} className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-lg">
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : job.id)}
                  className="absolute right-4 top-4 z-10 rounded-lg border border-gray-200 bg-white/90 p-2 text-gray-400 backdrop-blur-sm transition-colors hover:border-sky-200 hover:text-sky-600"
                  aria-label={isExpanded ? `Collapse ${job.title}` : `Expand ${job.title}`}
                  aria-expanded={isExpanded}
                >
                  <svg className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                <div className="p-4 pr-14 sm:p-5 sm:pr-16">
                  {/* Image floats left so the title, tags and description text wrap naturally around it */}
                  <div className="relative float-left mb-3 mr-4 h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-gray-100 bg-gradient-to-br from-sky-50 to-gray-100 shadow-md sm:h-32 sm:w-32">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={job.imageUrl ? resolveImageUrl(job.imageUrl) : JOB_IMAGE_FALLBACK}
                      alt={job.company}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      onError={(event) => {
                        const target = event.currentTarget;
                        if (target.src.endsWith(JOB_IMAGE_FALLBACK)) return;
                        target.src = JOB_IMAGE_FALLBACK;
                      }}
                    />
                    <span className="absolute left-1.5 top-1.5 rounded-full border border-emerald-200 bg-emerald-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm">
                      Open
                    </span>
                  </div>

                  <span className="block text-base font-bold leading-snug text-gray-900 sm:text-lg">{job.title}</span>
                  <p className="mt-0.5 text-sm text-gray-500">{job.company} · {job.location || job.country}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">{job.type}</span>
                    <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">{job.category}</span>
                    <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">{job.qualification}</span>
                    {job.salary && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">💰 {job.salary}</span>}
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-600">
                    {isExpanded ? job.description : previewText}
                  </p>
                  {hasReadMore && (
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : job.id)}
                      aria-expanded={isExpanded}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-600 transition-colors hover:text-sky-700"
                    >
                      {isExpanded ? 'Show less' : 'Read more'}
                      <svg className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                  <div className="clear-both" />
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-50 px-4 pb-4 pt-3">
                    <div className="mb-4">
                      <h3 className="text-sm font-bold text-gray-900">Full job description</h3>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">{job.description}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {formatJobDetails(job).map((item) => (
                        <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{item.label}</p>
                          <p className="mt-1 text-sm font-medium text-gray-700">{item.value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Application instructions</p>
                      <p className="mt-1 text-sm text-sky-800">Upload your CV through your profile and use the apply action below to follow the recruiter&apos;s instructions.</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link
                        href="/profile#cv-documents"
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sky-700"
                      >
                        📤 Upload CV to Apply
                      </Link>
                      <ShareJobButtons job={job} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function JobSeekersHub({
  meta,
  jobs,
  loading,
  error,
}: {
  meta: JobMeta | null;
  jobs: JobPost[];
  loading: boolean;
  error: string;
}) {
  const categories = useMemo(() => {
    const dynamicCategories = meta?.categories?.filter(Boolean) ?? [];
    if (dynamicCategories.length) return dynamicCategories;

    const uniqueCategories = Array.from(
      new Set(jobs.map((job) => job.category?.trim() || 'Other').filter(Boolean)),
    );

    return uniqueCategories.length > 0 ? uniqueCategories : ['Other'];
  }, [meta?.categories, jobs]);

  const jobsByCategory = useMemo(() => {
    const grouped = new Map<string, JobPost[]>();
    categories.forEach((category) => grouped.set(category, []));
    jobs.forEach((job) => {
      const bucket = grouped.get(job.category) ?? grouped.get('Other');
      if (bucket && !bucket.some((entry) => entry.id === job.id)) {
        bucket.push(job);
      }
    });
    return grouped;
  }, [categories, jobs]);

  // Only categories that actually have at least one open posting are shown —
  // empty categories are hidden rather than rendered with a placeholder.
  const populatedCategories = useMemo(
    () => categories.filter((category) => (jobsByCategory.get(category) ?? []).length > 0),
    [categories, jobsByCategory],
  );

  return (
    <section className="mt-8">
      <div className="mb-4">
        <h2 className="text-xl font-black text-gray-900">Job Seekers Hub</h2>
        <p className="mt-0.5 text-sm text-gray-500">Browse active job postings grouped by category.</p>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="animate-pulse rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="h-5 w-1/3 rounded bg-gray-100" />
              <div className="mt-4 space-y-3">
                <div className="h-16 rounded-xl bg-gray-100" />
                <div className="h-16 rounded-xl bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-100 bg-white p-6 text-sm text-red-500">{error}</div>
      ) : populatedCategories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
          <div className="text-4xl mb-3">🗂️</div>
          <p className="font-bold text-gray-700 mb-1">No open postings yet</p>
          <p className="text-sm text-gray-400">Check back soon — new jobs are added regularly.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {populatedCategories.map((category) => {
            const categoryJobs = jobsByCategory.get(category) ?? [];
            return (
              <div key={category} className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-sky-50 via-indigo-50 to-purple-50 px-4 py-3">
                  <h3 className="text-sm font-bold text-gray-900">{category}</h3>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-sky-700 shadow-sm">
                    {categoryJobs.length} posting{categoryJobs.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex-1 space-y-3 p-4">
                  {categoryJobs.map((job) => (
                    <div
                      key={job.id}
                      className="group overflow-hidden rounded-xl border border-gray-100 bg-gray-50 p-3 transition-colors hover:border-sky-200 hover:bg-sky-50/60"
                    >
                      {/* Image floats left; title/company/description text wraps around it */}
                      <div className="float-left mb-2 mr-3 h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={job.imageUrl ? resolveImageUrl(job.imageUrl) : JOB_IMAGE_FALLBACK}
                          alt={job.company}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                      </div>
                      <p className="text-sm font-bold leading-snug text-gray-900">{job.title}</p>
                      <p className="text-xs text-gray-500">{job.company} · {job.location || job.country}</p>
                      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-gray-500">{truncateJobDescription(job.description)}</p>
                      <div className="clear-both" />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function JobsMarketPage() {
  const { user, loading: authLoading } = useAuth();
  const [jobMeta, setJobMeta] = useState<JobMeta | null>(null);
  const [hubJobs, setHubJobs] = useState<JobPost[]>([]);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [candidatesError, setCandidatesError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<DocTypeFilter>('ALL');
  const [preview, setPreview] = useState<PreviewModal | null>(null);

  const fetchCandidates = useCallback(async (pg = 1, query = '') => {
    setLoading(true);
    try {
      const { data } = await api.get('/upload/candidates', {
        params: { page: pg, limit: 20, ...(query.trim() && { q: query.trim() }) },
      });
      setCandidates(data.candidates || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
      setPages(data.pages || 1);
      setCandidatesError('');
    } catch (err: unknown) {
      const status = extractResponseStatus(err);
      setCandidates([]);
      setCandidatesError(status === 401 ? 'Please sign in to view candidate listings.' : 'Could not load candidate listings right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchCandidates(1, q);
  }, [fetchCandidates, q, user]);

  useEffect(() => {
    if (!authLoading && !user) {
      setLoading(false);
      setCandidates([]);
      setCandidatesError('');
    }
  }, [authLoading, user]);

  useEffect(() => {
    let active = true;
    setHubLoading(true);
    Promise.all([
      api.get('/jobs/meta'),
      api.get('/jobs?limit=500&status=ACTIVE'),
    ])
      .then(([metaResponse, jobsResponse]) => {
        if (!active) return;
        setJobMeta(metaResponse.data);
        const openJobs = (jobsResponse.data.jobs || []).filter((j: JobPost) => !j.status || j.status === 'ACTIVE');
        setHubJobs(openJobs);
        setHubError('');
      })
      .catch(() => {
        if (!active) return;
        setHubJobs([]);
        setHubError('Could not load grouped job postings right now.');
      })
      .finally(() => {
        if (active) setHubLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQ(searchInput);
  };

  // Filter candidates to those who have at least one doc matching the selected type
  const filteredCandidates = typeFilter === 'ALL'
    ? candidates
    : candidates.filter((c) => c.documents.some((d) => d.type === typeFilter));

  const DOC_TYPES: { value: DocTypeFilter; label: string; icon: string }[] = [
    { value: 'ALL', label: 'All', icon: '🗂️' },
    { value: 'CV', label: 'CV', icon: '📄' },
    { value: 'CERTIFICATE', label: 'Certificates', icon: '🏆' },
    { value: 'PORTFOLIO', label: 'Portfolio', icon: '🎨' },
    { value: 'OTHER', label: 'Other', icon: '📎' },
  ];

  if (authLoading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-200 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6 animate-fade-in">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Jobs Market' },
        ]}
      />

      {/* Hero */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-sky-700 via-sky-600 to-blue-500 px-5 py-5 text-white shadow-xl mb-4">
        <p className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/85">
          3R Elite Job Market
        </p>
        <h1 className="mt-4 text-3xl font-black tracking-tight">Find Top Candidates</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/85">
          Browse professionals who have uploaded their CVs and certificates. Review public profiles and shortlist candidates looking for opportunities.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row gap-3">
          <Link
            href="/profile#cv-documents"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-sky-700 rounded-xl text-sm font-bold hover:bg-sky-50 transition-colors shadow-sm"
          >
            📤 Upload Your CV
          </Link>
          <span className="self-center text-sm text-white/70">
            {total} candidate{total !== 1 ? 's' : ''} available
          </span>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4 flex gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name…"
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
        />
        <button
          type="submit"
          className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold transition-colors"
        >
          Search
        </button>
        {q && (
          <button
            type="button"
            onClick={() => { setSearchInput(''); setQ(''); }}
            className="px-3 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-500 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </form>

      {/* Document type tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {DOC_TYPES.map((dt) => (
          <button
            key={dt.value}
            onClick={() => setTypeFilter(dt.value)}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              typeFilter === dt.value
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-sky-400 hover:text-sky-600'
            }`}
          >
            <span>{dt.icon}</span> {dt.label}
          </button>
        ))}
      </div>

      {/* Candidates grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 shimmer rounded w-2/3" />
                  <div className="h-3 shimmer rounded w-1/3" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-8 shimmer rounded-lg" />
                <div className="h-8 shimmer rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : candidatesError ? (
        <div className="bg-white rounded-2xl border border-red-100 p-8 text-center">
          <p className="font-bold text-red-600 mb-2">Unable to load candidates</p>
          <p className="text-sm text-red-500">{candidatesError}</p>
        </div>
      ) : filteredCandidates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="text-5xl mb-4">🔍</div>
          <p className="font-bold text-gray-800 mb-2">No candidates found</p>
          <p className="text-sm text-gray-500 mb-4">
            {q ? `No results for "${q}".` : typeFilter !== 'ALL' ? `No candidates with ${typeFilter} documents.` : 'No candidates have uploaded CVs yet.'}
          </p>
          <Link
            href="/profile#cv-documents"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Be the first — Upload your CV
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCandidates.map((candidate) => {
            // Show only docs matching the current type filter (or all docs if ALL)
            const visibleDocs = typeFilter === 'ALL'
              ? candidate.documents
              : candidate.documents.filter((d) => d.type === typeFilter);
            const cvDoc = candidate.documents.find((d) => d.type === 'CV');
            return (
              <div key={candidate.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
                {/* CV preview image */}
                {cvDoc && (
                  <CvThumbnail doc={cvDoc} onClick={() => setPreview({ candidate, doc: cvDoc })} />
                )}

                {/* Candidate header */}
                <div className="flex items-center gap-3 mb-4">
                  <Link href={`/jobs/${candidate.id}`}>
                    <UserAvatar user={{ id: candidate.id, name: candidate.name, avatar: candidate.avatar ?? undefined }} size="md" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/jobs/${candidate.id}`} className="font-bold text-gray-900 text-sm truncate hover:text-sky-700 transition-colors block">
                      {candidate.name}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {COUNTRY_FLAGS[candidate.country] || '🌍'} {candidate.country}
                    </p>
                  </div>
                  <Link
                    href={`/jobs/${candidate.id}`}
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    👁 View Profile
                  </Link>
                </div>

                {/* Documents */}
                <div className="space-y-2">
                  {visibleDocs.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => setPreview({ candidate, doc })}
                      className="w-full flex items-center gap-2 p-2.5 bg-gray-50 rounded-xl border border-gray-100 hover:border-sky-200 hover:bg-sky-50 transition-all group text-left"
                    >
                      <span className="text-lg shrink-0">{DOC_ICONS[doc.type] || '📎'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-sky-700">
                          {doc.title}
                        </p>
                        <p className="text-[10px] text-gray-400">{doc.type}</p>
                      </div>
                      <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-sky-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                  ))}
                </div>

                {/* View full profile link */}
                <Link
                  href={`/jobs/${candidate.id}`}
                  className="mt-3 flex items-center justify-center gap-1 text-xs text-sky-600 hover:text-sky-800 font-medium transition-colors"
                >
                  View Full Profile →
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            disabled={page <= 1}
            onClick={() => { setPage((p) => p - 1); fetchCandidates(page - 1, q); }}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-500 self-center">
            Page {page} of {pages}
          </span>
          <button
            disabled={page >= pages}
            onClick={() => { setPage((p) => p + 1); fetchCandidates(page + 1, q); }}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {/* ── Jobs Board ─────────────────────────────────── */}
      <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-10 text-center text-gray-400 text-sm">Loading job filters…</div>}>
        <JobsBoard meta={jobMeta} />
      </Suspense>

      <JobSeekersHub meta={jobMeta} jobs={hubJobs} loading={hubLoading} error={hubError} />

      {/* ── Hire with Us ─────────────────────────────────── */}
      <section className="mt-6">
        {/* Hire with Us CTA */}
        <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-sky-900 via-sky-800 to-sky-700 px-6 py-6 text-white shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center gap-5">
            <div className="flex-1">
              <h2 className="text-2xl font-black tracking-tight">Hire with Us</h2>
              <p className="mt-2 max-w-xl text-white/80 text-sm">
                Access thousands of verified candidates across UAE, Kenya, Uganda & China. Post jobs, browse CVs, and connect directly with talent — all in one place.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="flex items-center gap-2 text-xs text-white/70">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                  Verified CV uploads
                </div>
                <div className="flex items-center gap-2 text-xs text-white/70">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                  Category-based job discovery
                </div>
                <div className="flex items-center gap-2 text-xs text-white/70">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                  Multi-country reach
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 shrink-0">
              <Link
                href="/cv-services"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-sky-800 rounded-xl text-sm font-bold hover:bg-sky-50 transition-colors shadow-sm"
              >
                📄 Post a Job
              </Link>
              <Link
                href="/profile#cv-documents"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white/15 hover:bg-white/25 border border-white/30 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                📤 Upload Your CV
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Document preview modal */}
      {preview && (
        <DocPreviewModal preview={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
