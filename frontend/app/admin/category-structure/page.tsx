'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  MAX_MENU_GROUP, MAX_SHORT_NAME, buildTree, computeChanges, firstError, groupSuggestions, initialDrafts,
  matchesSearch, mergeTargets, reorder, type Draft, type Drafts, type FlatCategory,
} from '@/components/admin/categoryStructureModel';

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message ||
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

export default function AdminCategoryStructurePage() {
  const [flat, setFlat] = useState<FlatCategory[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [mergeFor, setMergeFor] = useState<FlatCategory | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeConfirm, setMergeConfirm] = useState('');
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/categories-structure');
      const list: FlatCategory[] = data.categories ?? [];
      setFlat(list);
      setDrafts(initialDrafts(list));
    } catch (e) {
      setNotice({ text: errMsg(e, 'Failed to load categories'), error: true });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const tree = useMemo(() => buildTree(flat, drafts), [flat, drafts]);
  const changes = useMemo(() => computeChanges(flat, drafts), [flat, drafts]);
  const problem = useMemo(() => firstError(flat, drafts), [flat, drafts]);
  const searching = query.trim() !== '';

  const edit = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const move = (siblings: FlatCategory[], id: string, delta: -1 | 1) => {
    const next = reorder(siblings, drafts, id, delta);
    setDrafts((d) => {
      const copy = { ...d };
      for (const [cid, order] of Object.entries(next)) copy[cid] = { ...copy[cid], sortOrder: order };
      return copy;
    });
  };
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    if (problem) { setNotice({ text: problem.message, error: true }); return; }
    setSaving(true); setNotice(null);
    try {
      await api.put('/admin/categories-structure', { items: changes });
      setNotice({ text: `Saved ${changes.length} change${changes.length === 1 ? '' : 's'}. Visitors see them within about two minutes.`, error: false });
      await load();
    } catch (e) {
      setNotice({ text: errMsg(e, 'Failed to save'), error: true });
    } finally { setSaving(false); }
  };

  const doMerge = async () => {
    if (!mergeFor || !mergeTarget) return;
    setMerging(true); setNotice(null);
    try {
      const { data } = await api.post(`/admin/categories/${mergeFor.id}/merge`, { targetId: mergeTarget });
      setNotice({ text: `Merged "${mergeFor.name}": ${data.movedListings} listing(s), ${data.movedChildren} subcategor${data.movedChildren === 1 ? 'y' : 'ies'} and ${data.updatedAlerts} alert(s) moved.`, error: false });
      setMergeFor(null); setMergeTarget(''); setMergeConfirm('');
      await load();
    } catch (e) {
      setNotice({ text: errMsg(e, 'Merge failed'), error: true });
    } finally { setMerging(false); }
  };

  const row = (c: FlatCategory, siblings: FlatCategory[], isParent: boolean, groups: string[]) => {
    const d = drafts[c.id];
    if (!d) return null;
    const idx = siblings.findIndex((s) => s.id === c.id);
    const err = (d.shortName ?? '').length > MAX_SHORT_NAME || (d.menuGroup ?? '').length > MAX_MENU_GROUP;
    return (
      <div className={`flex flex-wrap items-center gap-2 px-3 py-2 ${isParent ? 'bg-gray-50' : 'pl-9'} ${!d.isActive ? 'opacity-60' : ''}`}>
        {isParent ? (
          <button type="button" onClick={() => toggle(c.id)} className="w-6 text-gray-500" aria-label={`${open.has(c.id) || searching ? 'Collapse' : 'Expand'} ${c.name}`}>{open.has(c.id) || searching ? '▾' : '▸'}</button>
        ) : <span className="w-2" />}
        <span className="text-lg" aria-hidden="true">{c.icon}</span>
        <div className="min-w-[10rem] flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{c.name}{!d.isActive && <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">RETIRED</span>}</p>
          <p className="truncate text-[11px] text-gray-500">{c.slug} · {c._count?.listings ?? 0} listing{(c._count?.listings ?? 0) === 1 ? '' : 's'}</p>
        </div>
        <label className="text-[11px] text-gray-500">
          <span className="sr-only">Short name for {c.name}</span>
          <input
            value={d.shortName ?? ''} onChange={(e) => edit(c.id, { shortName: e.target.value })} placeholder="Short name"
            aria-label={`Short name for ${c.name}`} maxLength={MAX_SHORT_NAME + 10}
            className={`w-36 rounded-lg border px-2 py-1 text-sm ${(d.shortName ?? '').length > MAX_SHORT_NAME ? 'border-red-400' : 'border-gray-200'}`}
          />
        </label>
        {!isParent && (
          <label className="text-[11px] text-gray-500">
            <span className="sr-only">Group for {c.name}</span>
            <input
              list={`groups-${c.parentId}`} value={d.menuGroup ?? ''} onChange={(e) => edit(c.id, { menuGroup: e.target.value })} placeholder="Group"
              aria-label={`Group for ${c.name}`} className="w-40 rounded-lg border border-gray-200 px-2 py-1 text-sm"
            />
            <datalist id={`groups-${c.parentId}`}>{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </label>
        )}
        <label className="flex items-center gap-1 text-xs font-medium text-gray-600">
          <input type="checkbox" checked={d.isActive} onChange={(e) => edit(c.id, { isActive: e.target.checked })} aria-label={`Active: ${c.name}`} /> Active
        </label>
        <div className="flex items-center gap-1">
          <button type="button" disabled={idx <= 0 || searching} onClick={() => move(siblings, c.id, -1)} className="rounded border border-gray-200 px-2 py-0.5 text-xs disabled:opacity-30" aria-label={`Move ${c.name} up`}>▲</button>
          <button type="button" disabled={idx === siblings.length - 1 || searching} onClick={() => move(siblings, c.id, 1)} className="rounded border border-gray-200 px-2 py-0.5 text-xs disabled:opacity-30" aria-label={`Move ${c.name} down`}>▼</button>
          <button type="button" onClick={() => { setMergeFor(c); setMergeTarget(''); setMergeConfirm(''); }} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50" aria-label={`Merge ${c.name} into another category`}>Merge…</button>
        </div>
        {err && <p className="basis-full text-xs text-red-600">Too long (short name ≤ {MAX_SHORT_NAME}, group ≤ {MAX_MENU_GROUP}).</p>}
      </div>
    );
  };

  const mergeCandidates = mergeFor ? mergeTargets(flat, mergeFor) : [];
  const mergeSource = mergeFor ? flat.find((c) => c.id === mergeFor.id) : null;
  const mergeCount = mergeSource?._count?.listings ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-gray-900 sm:text-2xl"><span aria-hidden="true">🧱</span> Category structure</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Reorder categories, give long names a <strong>short name</strong> for tiles and menus, group subcategories on category pages, retire categories you no longer want
          (hidden everywhere, existing listings stay), or merge duplicates. Buyer-facing order and hiding of top-level categories is under{' '}
          <Link href="/admin/category-layout" className="text-red-600 hover:underline">Category Layout</Link>.
        </p>
      </div>

      {notice && <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${notice.error ? 'border-red-100 bg-red-50 text-red-700' : 'border-green-100 bg-green-50 text-green-700'}`}>{notice.text}</p>}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3">
        <label htmlFor="cat-search" className="sr-only">Search categories</label>
        <input id="cat-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, slug, short name or group" className="input-premium min-w-[14rem] flex-1 text-sm" />
        <button type="button" onClick={() => setOpen(new Set(tree.map((n) => n.cat.id)))} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">Expand all</button>
        <button type="button" onClick={() => setOpen(new Set())} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">Collapse all</button>
        <button type="button" onClick={() => setDrafts(initialDrafts(flat))} disabled={changes.length === 0 || saving} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">Discard changes</button>
        <button type="button" onClick={save} disabled={changes.length === 0 || saving || !!problem} className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
          {saving ? 'Saving…' : changes.length ? `Save ${changes.length} change${changes.length === 1 ? '' : 's'}` : 'No changes'}
        </button>
        {searching && <p className="basis-full text-xs text-gray-500">Reordering is paused while searching.</p>}
      </div>

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <ul className="divide-y divide-gray-100">
            {tree.map(({ cat, children }) => {
              const parentMatch = matchesSearch(cat, drafts[cat.id], query);
              const kids = searching ? children.filter((c) => parentMatch || matchesSearch(c, drafts[c.id], query)) : children;
              if (searching && !parentMatch && kids.length === 0) return null;
              const expanded = searching || open.has(cat.id);
              const groups = groupSuggestions(flat, cat.id, drafts);
              return (
                <li key={cat.id}>
                  {row(cat, tree.map((n) => n.cat), true, [])}
                  {expanded && <ul className="divide-y divide-gray-50">{kids.map((c) => <li key={c.id}>{row(c, children, false, groups)}</li>)}</ul>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {mergeFor && (
        <div role="dialog" aria-modal="true" aria-label={`Merge ${mergeFor.name}`} className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Merge “{mergeFor.name}”</h2>
            <p className="mt-1 text-sm text-gray-600">
              Moves its {mergeCount} listing{mergeCount === 1 ? '' : 's'}, any subcategories and alerts into the category you pick, then <strong>deletes “{mergeFor.name}”</strong>. This cannot be undone.
            </p>
            <label className="mt-3 block text-sm font-medium text-gray-700">Merge into
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} className="input-premium mt-1 w-full text-sm" aria-label="Merge target">
                <option value="">Choose a category…</option>
                {mergeCandidates.map((c) => <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{c.name}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-sm font-medium text-gray-700">Type <code className="rounded bg-gray-100 px-1">{mergeFor.slug}</code> to confirm
              <input value={mergeConfirm} onChange={(e) => setMergeConfirm(e.target.value)} className="input-premium mt-1 w-full text-sm" aria-label="Type the category slug to confirm" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setMergeFor(null)} className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={doMerge} disabled={!mergeTarget || mergeConfirm !== mergeFor.slug || merging} className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">{merging ? 'Merging…' : 'Merge and delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
