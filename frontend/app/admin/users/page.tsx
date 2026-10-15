'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Role, User } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/utils';

interface AdminApprovalAuditEntry {
  id: string;
  approvedAt: string;
  approvedUserId: string;
  approvedUserName: string;
  approvedUserEmail: string;
  approverId: string | null;
  approverName: string | null;
  approverEmail: string | null;
}

const MANAGEABLE_ROLES: Role[] = ['BUYER', 'SELLER', 'AGENT', 'ORGANIZATION', 'COMPANY', 'ADMIN'];

export default function AdminUsersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState('');
  const [promotingUserId, setPromotingUserId] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [approvalAudit, setApprovalAudit] = useState<AdminApprovalAuditEntry[]>([]);
  const [actionError, setActionError] = useState('');
  const [userEdits, setUserEdits] = useState<Record<string, { role: Role; isVerified: boolean }>>({});
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const fetchUsers = useCallback(async (query: string) => {
    setFetching(true);
    try {
      const params = query ? { search: query } : {};
      const { data } = await api.get('/admin/users', { params });
      setUsers(data.users);
      setTotal(data.pagination.total);
      const nextEdits: Record<string, { role: Role; isVerified: boolean }> = {};
      for (const item of data.users as User[]) {
        nextEdits[item.id] = { role: item.role, isVerified: item.isVerified };
      }
      setUserEdits(nextEdits);
    } catch {
      // ignore
    } finally {
      setFetching(false);
    }
  }, []);

  const fetchApprovalAudit = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/users/admin-approval-audit');
      setApprovalAudit(data.audit || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'ADMIN')) router.push('/admin/auth/login');
    if (user?.role === 'ADMIN') {
      fetchUsers('');
      fetchApprovalAudit();
    }
  }, [user, loading, router, fetchUsers, fetchApprovalAudit]);

  useEffect(() => {
    if (!user || user.role !== 'ADMIN') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(search), 300);
    return () => { if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; } };
  }, [search, user, fetchUsers]);

  const toggleBan = async (userId: string, isBanned: boolean) => {
    await api.put(`/admin/users/${userId}`, { isBanned: !isBanned });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isBanned: !isBanned } : u));
  };

  const updateUserEdit = (
    userId: string,
    patch: Partial<{ role: Role; isVerified: boolean }>,
    currentRole: Role,
    currentVerified: boolean
  ) => {
    setUserEdits((prev) => ({
      ...prev,
      [userId]: {
        role: patch.role ?? prev[userId]?.role ?? currentRole,
        isVerified: patch.isVerified ?? prev[userId]?.isVerified ?? currentVerified,
      },
    }));
  };

  const saveUserControls = async (target: User) => {
    const edit = userEdits[target.id];
    if (!edit) return;
    setSavingUserId(target.id);
    try {
      setActionError('');
      const { data } = await api.put(`/admin/users/${target.id}`, {
        role: edit.role,
        isVerified: edit.isVerified,
      });
      setUsers((prev) => prev.map((u) => u.id === target.id ? { ...u, ...data } : u));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(msg || 'Failed to update user');
    } finally {
      setSavingUserId(null);
    }
  };

  const deleteUser = async (userId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) return;
    await api.delete(`/admin/users/${userId}`);
    await fetchUsers(search);
  };

  const approveAdmin = async (userId: string, name: string) => {
    if (!window.confirm(`Approve "${name}" as admin? They will get full admin access.`)) return;
    setPromotingUserId(userId);
    try {
      setActionError('');
      await api.post(`/admin/users/${userId}/approve-admin`);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: 'ADMIN', isVerified: true } : u));
      await fetchApprovalAudit();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(msg || 'Failed to approve admin');
    } finally {
      setPromotingUserId(null);
    }
  };

  if (loading || fetching) return <div className="p-8 text-center">Loading...</div>;

  return (
    <>
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Users</h1>
      <p className="text-gray-500 mb-6">{total} total users</p>
      {actionError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
        />
      </div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Country</th>
              <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Joined</th>
              <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => {
              const isSelf = user?.id === u.id;
              return (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-3 sm:px-6 py-3 sm:py-4 font-medium text-xs whitespace-nowrap max-w-[180px] truncate" title={u.name}>{u.name}</td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 text-gray-500 text-xs whitespace-nowrap max-w-[220px] truncate" title={u.email}>{u.email}</td>
                <td className="px-3 sm:px-6 py-3 sm:py-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                  }`}>{u.role}</span>
                </td>
                 <td className="px-3 sm:px-6 py-3 sm:py-4 text-xs whitespace-nowrap max-w-[90px] truncate" title={u.country}>{u.country}</td>
                 <td className="px-3 sm:px-6 py-3 sm:py-4 text-gray-500 text-xs whitespace-nowrap">{formatDate(u.createdAt)}</td>
                <td className="px-3 sm:px-6 py-3 sm:py-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium mr-1 ${
                    u.isBanned ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>{u.isBanned ? 'Banned' : 'Active'}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.isVerified ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>{u.isVerified ? 'Verified' : 'Unverified'}</span>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4">
                    <div className="flex flex-wrap gap-2 items-center text-xs">
                      <select
                        value={userEdits[u.id]?.role || u.role}
                        onChange={(e) => updateUserEdit(u.id, { role: e.target.value as Role }, u.role, u.isVerified)}
                        disabled={savingUserId === u.id || isSelf}
                        className="text-xs px-2 py-1.5 rounded border border-gray-300 bg-white disabled:bg-gray-100"
                      >
                        {MANAGEABLE_ROLES.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                      <label className="inline-flex items-center gap-1 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={userEdits[u.id]?.isVerified ?? u.isVerified}
                          onChange={(e) => updateUserEdit(u.id, { isVerified: e.target.checked }, u.role, u.isVerified)}
                          disabled={savingUserId === u.id}
                        />
                        Verified
                      </label>
                      <button
                        onClick={() => saveUserControls(u)}
                        disabled={savingUserId === u.id}
                        className="text-xs px-3 py-1.5 rounded font-medium bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed transition-colors"
                      >
                        {savingUserId === u.id ? 'Saving...' : 'Save'}
                      </button>
                      {u.role !== 'ADMIN' && (
                       <button
                         onClick={() => approveAdmin(u.id, u.name)}
                         disabled={promotingUserId === u.id}
                         className="text-xs px-3 py-1.5 rounded font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300 disabled:cursor-not-allowed transition-colors"
                       >
                         {promotingUserId === u.id ? 'Approving...' : 'Approve Admin'}
                       </button>
                      )}
                      <button
                        onClick={() => toggleBan(u.id, u.isBanned)}
                        disabled={isSelf}
                        className={`text-xs px-3 py-1.5 rounded font-medium ${
                          u.isBanned ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-red-500 text-white hover:bg-red-600'
                        } transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed`}
                      >
                        {u.isBanned ? 'Unban' : 'Ban'}
                      </button>
                      <button
                        onClick={() => deleteUser(u.id, u.name)}
                        disabled={isSelf}
                        className="text-xs px-3 py-1.5 rounded font-medium bg-gray-700 text-white hover:bg-gray-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        Delete
                      </button>
                    </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Admin Approval Audit</h2>
          <p className="text-xs text-gray-500 mt-1">Latest admin role approvals with approver details.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Approved User</th>
                <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Approver</th>
                <th className="text-left px-3 sm:px-6 py-3 font-medium text-gray-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {approvalAudit.length === 0 && (
                <tr>
                  <td className="px-3 sm:px-6 py-4 text-gray-500" colSpan={3}>No admin approvals recorded yet.</td>
                </tr>
              )}
              {approvalAudit.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-3 sm:px-6 py-3 sm:py-4">
                    <div className="font-medium text-gray-900 text-xs whitespace-nowrap max-w-[180px] truncate" title={entry.approvedUserName}>{entry.approvedUserName}</div>
                    <div className="text-xs text-gray-500 whitespace-nowrap max-w-[220px] truncate" title={entry.approvedUserEmail}>{entry.approvedUserEmail}</div>
                  </td>
                  <td className="px-3 sm:px-6 py-3 sm:py-4">
                    <div className="font-medium text-gray-900 text-xs whitespace-nowrap max-w-[180px] truncate" title={entry.approverName || 'Unknown admin'}>{entry.approverName || 'Unknown admin'}</div>
                    {entry.approverEmail && <div className="text-xs text-gray-500 whitespace-nowrap max-w-[220px] truncate" title={entry.approverEmail}>{entry.approverEmail}</div>}
                  </td>
                  <td className="px-3 sm:px-6 py-3 sm:py-4 text-gray-600">{formatDate(entry.approvedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
