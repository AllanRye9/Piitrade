'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Coupon } from '@/lib/types';

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: '', type: 'PERCENTAGE', value: '', minOrderAmount: '', maxUses: '', expiresAt: '', isActive: true });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchCoupons = () => {
    setLoading(true);
    api.get('/admin/coupons').then((r) => setCoupons(r.data.coupons ?? [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchCoupons(); }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value: parseFloat(form.value),
        minOrderAmount: form.minOrderAmount ? parseFloat(form.minOrderAmount) : null,
        maxUses: form.maxUses ? parseInt(form.maxUses) : null,
        expiresAt: form.expiresAt || null,
        isActive: form.isActive,
      };
      if (editId) {
        await api.put(`/admin/coupons/${editId}`, payload);
      } else {
        await api.post('/admin/coupons', payload);
      }
      setForm({ code: '', type: 'PERCENTAGE', value: '', minOrderAmount: '', maxUses: '', expiresAt: '', isActive: true });
      setEditId(null);
      fetchCoupons();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to save coupon');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c: Coupon) => {
    setEditId(c.id);
    setForm({
      code: c.code,
      type: c.type,
      value: String(c.value),
      minOrderAmount: c.minOrderAmount ? String(c.minOrderAmount) : '',
      maxUses: c.maxUses ? String(c.maxUses) : '',
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '',
      isActive: c.isActive,
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this coupon?')) return;
    await api.delete(`/admin/coupons/${id}`).catch(() => {});
    fetchCoupons();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Coupons</h1>

      <div className="grid lg:grid-cols-[1fr_400px] gap-6">
        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : coupons.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No coupons yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Type / Value</th>
                  <th className="px-4 py-3 text-center">Uses</th>
                  <th className="px-4 py-3 text-center">Active</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {coupons.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-semibold text-red-700">{c.code}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {c.type === 'PERCENTAGE' ? `${c.value}%` : c.type === 'FIXED_AMOUNT' ? `${c.value} off` : 'Free shipping'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">{c.usedCount}{c.maxUses ? `/${c.maxUses}` : ''}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => handleEdit(c)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">Edit</button>
                        <button onClick={() => handleDelete(c.id)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="font-bold text-gray-900 mb-4">{editId ? 'Edit Coupon' : 'Create Coupon'}</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3 mb-4">{error}</p>}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} required disabled={!!editId}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-red-300 disabled:bg-gray-50" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300">
                  <option value="PERCENTAGE">Percentage</option>
                  <option value="FIXED_AMOUNT">Fixed Amount</option>
                  <option value="FREE_SHIPPING">Free Shipping</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                <input type="number" value={form.value} onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} required min="0"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min Order</label>
                <input type="number" value={form.minOrderAmount} onChange={(e) => setForm((p) => ({ ...p, minOrderAmount: e.target.value }))} min="0"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Uses</label>
                <input type="number" value={form.maxUses} onChange={(e) => setForm((p) => ({ ...p, maxUses: e.target.value }))} min="1"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expires At</label>
              <input type="date" value={form.expiresAt} onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} id="isActive"
                className="rounded" />
              <label htmlFor="isActive" className="text-sm font-medium text-gray-700">Active</label>
            </div>
            <div className="flex gap-2">
              {editId && (
                <button type="button" onClick={() => { setEditId(null); setForm({ code: '', type: 'PERCENTAGE', value: '', minOrderAmount: '', maxUses: '', expiresAt: '', isActive: true }); }}
                  className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold">
                  Cancel
                </button>
              )}
              <button type="submit" disabled={saving}
                className="flex-1 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving...' : editId ? 'Update' : 'Create Coupon'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
