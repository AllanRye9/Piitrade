'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { PackageScope, SellerPackage } from '@/lib/types';

const emptyForm = {
  name: '',
  description: '',
  scope: 'LISTING' as PackageScope,
  isFree: false,
  price: '',
  currency: 'AED',
  durationDays: '',
  maxListings: '',
  isActive: true,
};

export default function AdminPackagesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [packages, setPackages] = useState<SellerPackage[]>([]);
  const [fetching, setFetching] = useState(true);
  const [form, setForm] = useState({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [scope, setScope] = useState<PackageScope>('LISTING');

  const fetchPackages = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get('/admin/packages', { params: { scope } });
      setPackages(data.packages ?? []);
    } catch {
      // ignore
    } finally {
      setFetching(false);
    }
  }, [scope]);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'ADMIN') fetchPackages();
  }, [user, fetchPackages]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        scope: form.scope,
        isFree: form.isFree,
        price: form.isFree ? 0 : parseFloat(form.price) || 0,
        currency: form.currency,
        durationDays: parseInt(form.durationDays),
        maxListings: form.maxListings ? parseInt(form.maxListings) : null,
        isActive: form.isActive,
      };

      if (editId) {
        await api.put(`/admin/packages/${editId}`, payload);
      } else {
        await api.post('/admin/packages', payload);
      }

      setForm({ ...emptyForm });
      setEditId(null);
      await fetchPackages();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to save package');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (pkg: SellerPackage) => {
    setEditId(pkg.id);
    setForm({
      name: pkg.name,
      description: pkg.description ?? '',
      scope: pkg.scope,
      isFree: pkg.isFree,
      price: String(pkg.price),
      currency: pkg.currency,
      durationDays: String(pkg.durationDays),
      maxListings: pkg.maxListings != null ? String(pkg.maxListings) : '',
      isActive: pkg.isActive,
    });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this package? This cannot be undone.')) return;
    setDeleteId(id);
    try {
      await api.delete(`/admin/packages/${id}`);
      await fetchPackages();
    } catch {
      // ignore
    } finally {
      setDeleteId(null);
    }
  };

  const cancelEdit = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setError('');
  };

  if (loading) return null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Seller Packages</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure listing and CV subscription packages. Listing sellers can be auto-enrolled in a free listing package; paid packages require a payment reference.
        </p>
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-2xl">
          <strong>CV packages:</strong> only one can govern the CV builder&apos;s download button at a time — activating a new CV package automatically overwrites (deactivates) the previous one. &ldquo;Feature Limit&rdquo; caps how many CVs a person may generate under it, and &ldquo;Duration (days)&rdquo; is how long the package stays in effect after creation. There is no default price — if you remove or deactivate every CV package (or its duration window elapses), the builder and cover letter tools disable downloading entirely until you activate a package again.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['LISTING', 'CV'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setScope(value);
              setEditId(null);
              setForm({ ...emptyForm, scope: value });
              setError('');
            }}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
              scope === value
                ? 'border-sky-600 bg-sky-600 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {value === 'LISTING' ? 'Listing Packages' : 'CV Packages'}
          </button>
        ))}
      </div>

      {/* ── Form ─────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          {editId ? 'Edit Package' : 'Create New Package'}
        </h2>
        <form onSubmit={handleSave} className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Name + isFree toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Package Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Free Trial, Starter Plan"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
                <select
                  value={form.scope}
                  onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value as PackageScope }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  <option value="LISTING">Listing</option>
                  <option value="CV">CV</option>
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isFree}
                  onChange={(e) => setForm((p) => ({ ...p, isFree: e.target.checked, price: e.target.checked ? '0' : p.price }))}
                  className="w-4 h-4 rounded accent-sky-600"
                />
                <span className="text-sm font-medium text-gray-700">Free Package</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer sm:ml-4">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                  className="w-4 h-4 rounded accent-sky-600"
                />
                <span className="text-sm font-medium text-gray-700">Active</span>
              </label>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={2}
              placeholder="Brief description shown to sellers"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"
            />
          </div>

          {/* Price + Currency + Duration + MaxListings */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                disabled={form.isFree}
                value={form.isFree ? '0' : form.price}
                onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                value={form.currency}
                onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                {['USD', 'AED', 'UGX', 'KES', 'CNY'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (days) *</label>
              <input
                type="number"
                required
                min="1"
                value={form.durationDays}
                onChange={(e) => setForm((p) => ({ ...p, durationDays: e.target.value }))}
                placeholder="e.g. 30"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.scope === 'CV' ? 'Feature Limit' : 'Max Listings'}
              </label>
              <input
                type="number"
                min="1"
                value={form.maxListings}
                onChange={(e) => setForm((p) => ({ ...p, maxListings: e.target.value }))}
                placeholder={form.scope === 'CV' ? 'Leave blank for all tools' : 'Unlimited'}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : editId ? 'Update Package' : 'Create Package'}
            </button>
            {editId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="px-5 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── Package List ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">All Packages</h2>
          <span className="text-xs text-gray-400">{packages.length} total</span>
        </div>

        {fetching ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : packages.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">No packages yet. Create one above.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {packages.map((pkg) => (
              <div key={pkg.id} className="flex items-start justify-between gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{pkg.name}</span>
                    {pkg.isFree && (
                      <span className="inline-block text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                        FREE TRIAL
                      </span>
                    )}
                    <span className="inline-block text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full">
                      {pkg.scope}
                    </span>
                    {!pkg.isActive && (
                      <span className="inline-block text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full">
                        INACTIVE
                      </span>
                    )}
                  </div>
                  {pkg.description && (
                    <p className="mt-0.5 text-xs text-gray-500 truncate">{pkg.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>
                      💰 {pkg.isFree ? 'Free' : `${pkg.price.toLocaleString('en-US')} ${pkg.currency}`}
                    </span>
                    <span>📅 {pkg.durationDays} day{pkg.durationDays !== 1 ? 's' : ''}</span>
                    <span>📋 {pkg.scope === 'CV' ? (pkg.maxListings != null ? `${pkg.maxListings} tools max` : 'All CV tools') : (pkg.maxListings != null ? `${pkg.maxListings} listings max` : 'Unlimited listings')}</span>
                    {pkg._count && (
                      <span>👥 {pkg._count.subscriptions} subscriber{pkg._count.subscriptions !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleEdit(pkg)}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(pkg.id)}
                    disabled={deleteId === pkg.id}
                    className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
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
  );
}
