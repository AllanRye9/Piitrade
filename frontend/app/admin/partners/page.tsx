'use client';

/** /admin/partners — approve / revoke Partner status. (Webstores live in /admin/webstores.) */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';

const COUNTRY_FLAGS: Record<string, string> = { UGANDA: '🇺🇬' };

interface StoreRow {
  id:                string;
  name:              string;
  slug:              string;
  logo:              string | null;
  isActive:          boolean;
  partnerApproved:   boolean;
  partnerLogoUrl:    string | null;
  partnerName:       string | null;
  partnerWebsite:    string | null;
  partnerApprovedAt: string | null;
  createdAt:         string;
  user: {
    id:          string;
    name:        string;
    email:       string;
    companyName: string | null;
    country:     string;
    kycStatus?:  string;
    isKycVerified?: boolean;
    role:        string;
  };
}

// ── Tab 2: Partners ───────────────────────────────────────────────────────────
// Approve/revoke partner status for stores. Approved partners appear on the public /partners page.

function PartnersTab() {
  const [stores, setStores]       = useState<StoreRow[]>([]);
  const [fetching, setFetching]   = useState(true);
  const [acting, setActing]       = useState<string | null>(null);
  const [filter, setFilter]       = useState<'all' | 'approved' | 'pending'>('all');
  const [search, setSearch]       = useState('');
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchStores = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get('/admin/stores/partners');
      setStores(data.stores || []);
    } catch {
      showToast('Failed to load stores', false);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  const approve = async (storeId: string, storeName: string) => {
    setActing(storeId);
    try {
      await api.patch(`/admin/stores/${storeId}/partner-approve`);
      showToast(`✓ "${storeName}" is now an approved partner`, true);
      await fetchStores();
    } catch {
      showToast('Approval failed — please try again', false);
    } finally {
      setActing(null);
    }
  };

  const revoke = async (storeId: string, storeName: string) => {
    if (!confirm(`Revoke partner status for "${storeName}"? Their logo will be removed from the Partners wall immediately.`)) return;
    setActing(storeId);
    try {
      await api.patch(`/admin/stores/${storeId}/partner-revoke`);
      showToast(`Partner status revoked for "${storeName}"`, true);
      await fetchStores();
    } catch {
      showToast('Revoke failed — please try again', false);
    } finally {
      setActing(null);
    }
  };

  const visible = stores.filter((s) => {
    if (filter === 'approved' && !s.partnerApproved) return false;
    if (filter === 'pending' && s.partnerApproved) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.user.name.toLowerCase().includes(q) ||
        s.user.email.toLowerCase().includes(q) ||
        (s.user.companyName || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const approvedCount = stores.filter((s) => s.partnerApproved).length;
  const pendingCount  = stores.filter((s) => !s.partnerApproved).length;

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold text-white transition-all ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Web Stores',   value: stores.length,   color: 'text-gray-700',    bg: 'bg-gray-50',    border: 'border-gray-200' },
          { label: 'Approved Partners',  value: approvedCount,   color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
          { label: 'Awaiting Decision',  value: pendingCount,    color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} ${s.border} border rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input
          type="text"
          placeholder="Search by Web Store name, owner, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
        />
        <div className="flex gap-2">
          {(['all', 'approved', 'pending'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all capitalize ${
                filter === f
                  ? 'bg-red-600 text-white border-red-600 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
              }`}>
              {f === 'all' ? `All (${stores.length})` : f === 'approved' ? `Partners (${approvedCount})` : `Pending (${pendingCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {fetching ? (
          <div className="p-10 text-center">
            <div className="w-8 h-8 border-4 border-red-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400">Loading Web Stores…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-3xl mb-3">🏪</p>
            <p className="text-sm text-gray-500 font-medium">
              {stores.length === 0 ? 'No Web Stores registered yet.' : 'No Web Stores match your search / filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Web Store</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider hidden md:table-cell">Owner / Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Partner Logo</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map((store) => (
                  <tr key={store.id} className="hover:bg-gray-50/60 transition-colors">

                    {/* Store info */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                          {store.logo ? (
                            <Image src={resolveImageUrl(store.logo)} alt={store.name}
                              width={40} height={40} className="object-cover w-full h-full" />
                          ) : (
                            <span className="text-gray-400 text-lg">🏪</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/stores/${store.slug}`} target="_blank"
                            className="font-semibold text-gray-900 hover:text-red-600 transition-colors truncate block max-w-[180px]">
                            {store.name}
                          </Link>
                          <p className="text-[11px] text-gray-400 truncate max-w-[180px]">
                            {COUNTRY_FLAGS[store.user.country] || '🌍'} {store.user.country}
                            {!store.isActive && <span className="ml-1 text-red-400">(inactive)</span>}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Owner / Contact */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="font-medium text-gray-700 truncate max-w-[160px]">
                        {store.user.companyName || store.user.name}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate max-w-[160px]">{store.user.email}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{store.user.role.toLowerCase()}</p>
                    </td>

                    {/* Partner logo */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {store.partnerLogoUrl || store.logo ? (
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                            <Image src={resolveImageUrl(store.partnerLogoUrl || store.logo || '')}
                              alt={`${store.partnerName || store.name} logo`}
                              width={40} height={40} className="object-contain p-0.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-700 truncate max-w-[120px]">
                              {store.partnerName || store.name}
                            </p>
                            {store.partnerWebsite && (
                              <a href={store.partnerWebsite.startsWith('http') ? store.partnerWebsite : `https://${store.partnerWebsite}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-[10px] text-red-500 hover:underline truncate max-w-[120px] block">
                                {store.partnerWebsite.replace(/^https?:\/\//, '')}
                              </a>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-gray-400 italic">
                          {store.partnerApproved ? 'No logo uploaded yet' : '—'}
                        </span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3 text-center">
                      {store.partnerApproved ? (
                        <div>
                          <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2.5 py-1 rounded-full">
                            ✓ Partner
                          </span>
                          {store.partnerApprovedAt && (
                            <p className="text-[9px] text-gray-400 mt-0.5">
                              {new Date(store.partnerApprovedAt).toLocaleDateString('en-US')}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-500 text-[11px] font-semibold px-2.5 py-1 rounded-full">
                          Not a Partner
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${store.user.isKycVerified ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                          {store.user.isKycVerified ? 'KYC ✓' : `KYC: ${(store.user.kycStatus ?? 'NOT_SUBMITTED').replace('_', ' ').toLowerCase()}`}
                        </span>
                        {!store.partnerApproved ? (
                          <button
                            onClick={() => approve(store.id, store.name)}
                            disabled={acting === store.id || !store.user.isKycVerified}
                            title={store.user.isKycVerified ? undefined : 'The owner must pass KYC verification first'}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            {acting === store.id
                              ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              : '✓'
                            }
                            Approve
                          </button>
                        ) : (
                          <button
                            onClick={() => revoke(store.id, store.name)}
                            disabled={acting === store.id}
                            className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold border border-red-200 transition-colors disabled:opacity-50 flex items-center gap-1"
                          >
                            {acting === store.id
                              ? <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                              : '×'
                            }
                            Revoke
                          </button>
                        )}
                        <Link href={`/stores/${store.slug}`} target="_blank"
                          className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold transition-colors">
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-5 bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
        <span className="text-lg shrink-0">ℹ️</span>
        <div className="text-sm text-red-800 space-y-1">
          <p><strong>Approval flow:</strong> Click <em>Approve</em> → the Web Store&rsquo;s own logo (or a separate one uploaded from <code className="bg-red-100 px-1 rounded text-xs">/dashboard/partner-logo</code>) appears automatically on the Partners wall.</p>
          <p><strong>Revoke:</strong> Immediately removes the logo from the public Partners wall and resets upload permission.</p>
        </div>
      </div>
    </div>
  );
}


export default function AdminPartnersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN')) router.replace('/admin/auth/login');
  }, [user, authLoading, router]);

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-start gap-4 mb-7">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-2xl shadow-md shrink-0">🤝</div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-black text-gray-900">Partners</h1>
          <p className="text-sm text-gray-500 mt-0.5">Approve or revoke partner status. A partner must have passed KYC verification. Approved partners appear on the public Partners page.</p>
        </div>
        <Link href="/partners" target="_blank" className="shrink-0 hidden sm:flex items-center gap-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">View Partners ↗</Link>
      </div>
      <PartnersTab />
    </div>
  );
}
