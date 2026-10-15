'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ShippingRate } from '@/lib/types';

export default function AdminShippingPage() {
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', country: 'UGANDA', minDays: '', maxDays: '', priceAed: '', priceUgx: '', priceKes: '', priceCny: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchRates = () => {
    setLoading(true);
    api.get('/admin/shipping-rates').then((r) => setRates(r.data.rates ?? [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchRates(); }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (editId) {
        await api.put(`/admin/shipping-rates/${editId}`, payload);
      } else {
        await api.post('/admin/shipping-rates', payload);
      }
      setForm({ name: '', description: '', country: 'UGANDA', minDays: '', maxDays: '', priceAed: '', priceUgx: '', priceKes: '', priceCny: '', isActive: true });
      setEditId(null);
      fetchRates();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Failed to save shipping rate');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (r: ShippingRate) => {
    setEditId(r.id);
    setForm({
      name: r.name,
      description: r.description ?? '',
      country: r.country,
      minDays: String(r.minDays),
      maxDays: String(r.maxDays),
      priceAed: String(r.priceAed),
      priceUgx: String(r.priceUgx),
      priceKes: String(r.priceKes),
      priceCny: String(r.priceCny),
      isActive: r.isActive,
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this shipping rate?')) return;
    await api.delete(`/admin/shipping-rates/${id}`).catch(() => {});
    fetchRates();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Shipping Rates</h1>

      <div className="grid lg:grid-cols-[1fr_420px] gap-6">
        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : rates.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No shipping rates yet</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Country</th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">Days</th>
                  <th className="px-4 py-3 text-right hidden md:table-cell">UGX</th>
                  <th className="px-4 py-3 text-center">Active</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rates.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-3 text-gray-600">{r.country}</td>
                    <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{r.minDays}–{r.maxDays}d</td>
                    <td className="px-4 py-3 text-right text-gray-700 hidden md:table-cell">{Number(r.priceUgx).toLocaleString("en-UG")}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.isActive ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => handleEdit(r)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">Edit</button>
                        <button onClick={() => handleDelete(r.id)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">Del</button>
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
          <h2 className="font-bold text-gray-900 mb-4">{editId ? 'Edit Shipping Rate' : 'Add Shipping Rate'}</h2>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3 mb-4">{error}</p>}
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <select value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300">
                <option value="UGANDA">🇺🇬 Uganda</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min Days</label>
                <input type="number" value={form.minDays} onChange={(e) => setForm((p) => ({ ...p, minDays: e.target.value }))} required min="0"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Days</label>
                <input type="number" value={form.maxDays} onChange={(e) => setForm((p) => ({ ...p, maxDays: e.target.value }))} required min="0"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price UGX</label>
                <input type="number" value={form.priceUgx} onChange={(e) => setForm((p) => ({ ...p, priceUgx: e.target.value }))} min="0" step="1"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="shippingIsActive" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} className="rounded" />
              <label htmlFor="shippingIsActive" className="text-sm font-medium text-gray-700">Active</label>
            </div>
            <div className="flex gap-2">
              {editId && (
                <button type="button" onClick={() => { setEditId(null); setForm({ name: '', description: '', country: 'UGANDA', minDays: '', maxDays: '', priceAed: '', priceUgx: '', priceKes: '', priceCny: '', isActive: true }); }}
                  className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold">
                  Cancel
                </button>
              )}
              <button type="submit" disabled={saving}
                className="flex-1 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving...' : editId ? 'Update' : 'Add Rate'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
