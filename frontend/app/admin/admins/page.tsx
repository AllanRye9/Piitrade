'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/momo';
import { useAuth } from '@/context/AuthContext';

interface AdminRow {
  id: string;
  name: string | null;
  email: string;
  isBanned: boolean;
  isPrimaryAdmin: boolean;
  adminPermissions: string[];
  createdAt: string;
  lastActiveAt: string | null;
}
interface Perm { key: string; label: string }

function Row({ admin, perms, isMe, onChanged }: { admin: AdminRow; perms: Perm[]; isMe: boolean; onChanged: () => void }) {
  const [selected, setSelected] = useState<string[]>(admin.adminPermissions);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmPrimary, setConfirmPrimary] = useState(false);

  useEffect(() => { setSelected(admin.adminPermissions); }, [admin.adminPermissions]);
  const dirty = selected.length !== admin.adminPermissions.length || selected.some((k) => !admin.adminPermissions.includes(k));
  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.put(`/admin/admins/${admin.id}/permissions`, { permissions: selected });
      setMsg({ ok: true, text: 'Access saved.' });
      onChanged();
    } catch (e) { setMsg({ ok: false, text: apiErrorMessage(e, 'Could not save access.') }); }
    finally { setSaving(false); }
  };
  const makePrimary = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.post(`/admin/admins/${admin.id}/make-primary`);
      window.location.reload(); // this account just became a secondary admin: reload so the menu reflects it
    } catch (e) { setMsg({ ok: false, text: apiErrorMessage(e, 'Could not transfer the primary role.') }); setSaving(false); setConfirmPrimary(false); }
  };

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">{admin.name || admin.email}{isMe && <span className="ml-1.5 text-xs font-medium text-slate-500">(you)</span>}</p>
          <p className="truncate text-xs text-slate-500">{admin.email}</p>
        </div>
        {admin.isPrimaryAdmin
          ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">Primary admin</span>
          : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">Secondary admin</span>}
        {admin.isBanned && <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold uppercase text-red-700">Banned</span>}
      </div>

      {admin.isPrimaryAdmin ? (
        <p className="mt-3 text-xs text-slate-500">Has every permission, and alone manages admins, backups and payment switches.</p>
      ) : (
        <>
          <fieldset className="mt-3" disabled={saving}>
            <legend className="text-xs font-semibold text-slate-600">Areas this admin can use</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {perms.map((p) => (
                <label key={p.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${selected.includes(p.key) ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                  <input type="checkbox" className="mt-0.5" checked={selected.includes(p.key)} onChange={() => toggle(p.key)} />
                  <span className="text-slate-800">{p.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={!dirty || saving} className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40">
              {saving ? 'Saving…' : 'Save access'}
            </button>
            {selected.length === 0 && <span className="text-xs text-amber-700">With no areas ticked this admin can only see the dashboard.</span>}
            {!confirmPrimary && !admin.isBanned && (
              <button type="button" onClick={() => setConfirmPrimary(true)} className="ml-auto rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Make primary admin</button>
            )}
          </div>
          {confirmPrimary && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" role="alertdialog" aria-label="Confirm primary admin transfer">
              <p className="font-semibold">Hand the primary role to {admin.email}?</p>
              <p className="mt-1">You become a secondary admin with every area granted, and lose the right to manage admins, backups and payment switches.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={makePrimary} disabled={saving} className="rounded-lg bg-amber-600 px-3 py-1.5 font-bold text-white">{saving ? 'Transferring…' : 'Yes, transfer'}</button>
                <button type="button" onClick={() => setConfirmPrimary(false)} className="rounded-lg border border-amber-300 px-3 py-1.5 font-semibold">Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      {msg && <p className={`mt-2 text-xs font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`} role="status">{msg.text}</p>}
    </li>
  );
}

export default function AdminTeamPage() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [max, setMax] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/admins');
      setAdmins(data.admins); setPerms(data.allPermissions); setMax(data.maxAdmins); setError('');
    } catch (e) { setError(apiErrorMessage(e, 'Could not load the admin team.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Admin Team</h1>
        <p className="mt-1 text-sm text-slate-600">
          The primary admin (the first admin) decides which areas each secondary admin can use. New secondary admins start with no access until you grant it.
          {max > 0 && admins && <> Admin seats used: <strong>{admins.length}/{max}</strong>.</>}
        </p>
        <p className="mt-1 text-xs text-slate-500">To add an admin, promote a user from Users, then grant their areas here.</p>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error} <button type="button" onClick={() => void load()} className="font-semibold underline">Try again</button></p>}
      {!admins && !error && <p className="text-sm text-slate-500" role="status">Loading…</p>}
      {admins && (
        <ul className="space-y-3">
          {admins.map((a) => <Row key={a.id} admin={a} perms={perms} isMe={a.id === user?.id} onChanged={() => void load()} />)}
        </ul>
      )}
    </div>
  );
}
