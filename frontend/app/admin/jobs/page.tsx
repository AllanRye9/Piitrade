'use client';

import { useEffect, useState, useCallback, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate, resolveImageUrl } from '@/lib/utils';

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
  postedById: string;
  country: string;
  createdAt: string;
  status: 'ACTIVE' | 'CLOSED' | 'DRAFT';
}

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Freelance', 'Internship', 'Temporary'];
const JOB_CATEGORIES = [
  'Technology', 'Finance', 'Healthcare', 'Education', 'Engineering',
  'Sales & Marketing', 'Admin & Support', 'Design & Creative',
  'Legal', 'Logistics & Transport', 'Hospitality', 'Construction', 'Other',
];
const QUALIFICATIONS = ["None Required", "High School", "Diploma", "Bachelor's", "Master's", "PhD", "Professional Cert"];
const COUNTRIES = ['UGANDA'];
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-gray-100 text-gray-600 border-gray-200',
  DRAFT: 'bg-amber-50 text-amber-700 border-amber-200',
};

const EMPTY_FORM = {
  title: '',
  company: '',
  location: '',
  type: 'Full-time',
  category: 'Technology',
  qualification: "Bachelor's",
  description: '',
  salary: '',
  deadline: '',
  imageUrl: '',
  country: 'UGANDA',
};

export default function AdminJobsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [jobs, setJobs] = useState<JobPost[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [fetching, setFetching] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (!loading && (!user || (user.role !== 'ADMIN' && user.role !== 'AGENT'))) {
      router.push('/admin/auth/login');
    }
  }, [user, loading, router]);

  const loadData = useCallback(async () => {
    setFetching(true);
    try {
      const params: Record<string, string> = { limit: '200' };
      if (filterStatus) params.status = filterStatus;
      if (filterCountry) params.country = filterCountry;
      const { data } = await api.get('/jobs', { params });
      setJobs(data.jobs || []);
    } catch {
      // ignore
    } finally {
      setFetching(false);
    }
  }, [filterStatus, filterCountry]);

  useEffect(() => {
    if (user?.role === 'ADMIN' || user?.role === 'AGENT') {
      loadData();
    }
  }, [loadData, user]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('images', file);
      const { data } = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm((prev) => ({ ...prev, imageUrl: data.urls?.[0] || '' }));
      e.target.value = '';
    } catch {
      setSaveError('Image upload failed. You can paste a URL instead.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.company.trim() || !form.description.trim()) return;
    setSaving(true);
    setSaveError('');

    try {
      if (editId) {
        await api.put(`/jobs/${editId}`, {
          ...form,
          salary: form.salary || null,
          deadline: form.deadline || null,
          imageUrl: form.imageUrl || null,
        });
      } else {
        await api.post('/jobs', {
          ...form,
          salary: form.salary || null,
          deadline: form.deadline || null,
          imageUrl: form.imageUrl || null,
        });
      }
      setForm({ ...EMPTY_FORM });
      setEditId(null);
      setShowForm(false);
      await loadData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setSaveError(msg || 'Failed to save job. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (job: JobPost) => {
    setForm({
      title: job.title,
      company: job.company,
      location: job.location,
      type: job.type,
      category: job.category,
      qualification: job.qualification,
      description: job.description,
      salary: job.salary || '',
      deadline: job.deadline || '',
      imageUrl: job.imageUrl || '',
      country: job.country,
    });
    setEditId(job.id);
    setShowForm(true);
    setSaveError('');
  };

  const handleStatusToggle = async (id: string, current: string) => {
    const next = current === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
    try {
      await api.put(`/jobs/${id}`, { status: next });
      setJobs((prev: JobPost[]) => prev.map((j: JobPost) => j.id === id ? { ...j, status: next as JobPost['status'] } : j));
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this job post?')) return;
    try {
      await api.delete(`/jobs/${id}`);
      setJobs((prev: JobPost[]) => prev.filter((j: JobPost) => j.id !== id));
    } catch {
      // ignore
    }
  };

  const filtered = jobs.filter((j: JobPost) => {
    if (search && !j.title.toLowerCase().includes(search.toLowerCase()) && !j.company.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return null;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Jobs Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">Post and manage job openings visible on the Jobs Market page</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditId(null); setForm({ ...EMPTY_FORM }); setSaveError(''); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Post New Job
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Jobs', value: jobs.length, color: 'from-sky-500 to-sky-600' },
          { label: 'Active', value: jobs.filter((j: JobPost) => j.status === 'ACTIVE').length, color: 'from-emerald-500 to-emerald-600' },
          { label: 'Closed', value: jobs.filter((j: JobPost) => j.status === 'CLOSED').length, color: 'from-gray-400 to-gray-500' },
        ].map((s) => (
          <div key={s.label} className={`bg-gradient-to-br ${s.color} rounded-2xl p-4 text-white shadow-sm`}>
            <p className="text-3xl font-black">{s.value}</p>
            <p className="text-white/75 text-xs font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Job Post Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-bold text-gray-900 text-base">{editId ? 'Edit Job Post' : 'Post a New Job'}</h2>
            <button
              onClick={() => { setShowForm(false); setEditId(null); }}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Job Title <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Senior Software Engineer"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Company <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  placeholder="e.g. Acme Corp"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Kampala, Uganda"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Country</label>
                <select
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Job Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  {JOB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Qualification Required</label>
                <select
                  value={form.qualification}
                  onChange={(e) => setForm({ ...form, qualification: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  {QUALIFICATIONS.map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Salary / Range <span className="font-normal text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                  placeholder="e.g. UGX 800,000 – 1,200,000/month"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Application Deadline <span className="font-normal text-gray-400">(optional)</span></label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Job Image <span className="font-normal text-gray-400">(optional — company logo or banner)</span></label>
                <div className="flex items-center gap-3">
                  {form.imageUrl && (
                    <div className="relative w-14 h-14 rounded-xl overflow-hidden border border-gray-100 shrink-0 bg-gray-50">
                      <Image src={resolveImageUrl(form.imageUrl)} alt="Job" fill className="object-cover" unoptimized />
                    </div>
                  )}
                  <div className="flex-1">
                    <input
                      type="url"
                      value={form.imageUrl}
                      onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                      placeholder="https://example.com/image.jpg"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 mb-1"
                    />
                    <label className="cursor-pointer text-xs text-red-600 hover:text-red-700 font-medium">
                      {uploadingImage ? 'Uploading...' : '📎 Upload image'}
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Job Description <span className="text-red-500">*</span></label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={5}
                placeholder="Describe the role, responsibilities, and requirements…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                required
              />
            </div>
            {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{saveError}</p>}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 shadow-sm"
              >
                {saving ? 'Saving…' : editId ? 'Update Job' : 'Publish Job'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditId(null); }}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or company…"
          className="flex-1 min-w-[200px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
        >
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="CLOSED">Closed</option>
        </select>
        <select
          value={filterCountry}
          onChange={(e) => setFilterCountry(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
        >
          <option value="">All Countries</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} job{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Jobs list */}
      <div className="space-y-3">
        {fetching ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-1/2" />
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                    <div className="h-3 bg-gray-100 rounded w-3/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-5xl mb-4">💼</div>
            <p className="font-bold text-gray-700 mb-1">No job posts yet</p>
            <p className="text-sm text-gray-400 mb-4">Post your first job opening to appear on the Jobs Market page</p>
            <button
              onClick={() => { setShowForm(true); setEditId(null); setForm({ ...EMPTY_FORM }); }}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-colors"
            >
              Post First Job
            </button>
          </div>
        ) : (
          filtered.map((job) => (
            <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                {job.imageUrl ? (
                  <div className="w-12 h-12 rounded-xl overflow-hidden border border-gray-100 shrink-0 relative bg-gray-50">
                    <Image
                      src={resolveImageUrl(job.imageUrl)}
                      alt={job.company}
                      fill
                      className="object-contain"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-2xl shrink-0">
                    💼
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900">{job.title}</h3>
                    <span className={`text-[10px] font-bold border px-2 py-0.5 rounded-full ${STATUS_COLORS[job.status]}`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{job.company} · {job.location}</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    <span className="text-[11px] bg-red-50 text-red-700 border border-red-100 px-2 py-0.5 rounded-full font-medium">{job.type}</span>
                    <span className="text-[11px] bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-full font-medium">{job.category}</span>
                    <span className="text-[11px] bg-gray-50 text-gray-600 border border-gray-100 px-2 py-0.5 rounded-full font-medium">{job.qualification}</span>
                    <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">{job.country}</span>
                    {job.salary && <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full font-medium">💰 {job.salary}</span>}
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2">{job.description}</p>
                </div>
                <div className="flex flex-row sm:flex-col gap-2 shrink-0">
                  <Link
                    href={`/admin/jobs/${job.id}/applications`}
                    className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors text-center"
                  >
                    Applications
                  </Link>
                  <button
                    onClick={() => handleEdit(job)}
                    className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleStatusToggle(job.id, job.status)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      job.status === 'ACTIVE'
                        ? 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {job.status === 'ACTIVE' ? 'Close' : 'Activate'}
                  </button>
                  <button
                    onClick={() => handleDelete(job.id)}
                    className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-4 text-[11px] text-gray-400">
                <span>Created: {formatDate(job.createdAt)}</span>
                {job.deadline && <span>Deadline: {job.deadline}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
