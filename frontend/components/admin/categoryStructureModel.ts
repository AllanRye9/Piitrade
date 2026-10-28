/**
 * Pure model for Admin → Category structure: build the tree from the flat admin list, track edits,
 * reorder siblings, validate, and compute the minimal batch to send to PUT /admin/categories-structure.
 */
export const MAX_SHORT_NAME = 24;
export const MAX_MENU_GROUP = 40;
export const ORDER_STEP = 10;

export interface FlatCategory {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  parentId: string | null;
  sortOrder: number;
  shortName: string | null;
  menuGroup: string | null;
  isActive: boolean;
  _count?: { listings: number };
}

export interface Draft { sortOrder: number; shortName: string | null; menuGroup: string | null; isActive: boolean }
export type Drafts = Record<string, Draft>;
export interface TreeNode { cat: FlatCategory; children: FlatCategory[] }

export const toDraft = (c: FlatCategory): Draft => ({ sortOrder: c.sortOrder, shortName: c.shortName, menuGroup: c.menuGroup, isActive: c.isActive });

export function initialDrafts(flat: FlatCategory[]): Drafts {
  return Object.fromEntries(flat.map((c) => [c.id, toDraft(c)]));
}

/** Siblings in display order under the DRAFT sortOrder (ties by name, like the API). */
export function sortSiblings(list: FlatCategory[], drafts: Drafts): FlatCategory[] {
  return [...list].sort((a, b) => (drafts[a.id]?.sortOrder ?? a.sortOrder) - (drafts[b.id]?.sortOrder ?? b.sortOrder) || a.name.localeCompare(b.name));
}

export function buildTree(flat: FlatCategory[], drafts: Drafts): TreeNode[] {
  const parents = sortSiblings(flat.filter((c) => !c.parentId), drafts);
  return parents.map((cat) => ({ cat, children: sortSiblings(flat.filter((c) => c.parentId === cat.id), drafts) }));
}

/** Move one sibling up/down; returns new sortOrders for the whole sibling set (0, 10, 20, …). */
export function reorder(siblings: FlatCategory[], drafts: Drafts, id: string, delta: -1 | 1): Record<string, number> {
  const ordered = sortSiblings(siblings, drafts).map((c) => c.id);
  const i = ordered.indexOf(id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= ordered.length) return {};
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  return Object.fromEntries(ordered.map((cid, idx) => [cid, idx * ORDER_STEP]));
}

export function validateDraft(d: Draft): string | null {
  if ((d.shortName ?? '').length > MAX_SHORT_NAME) return `Short name must be ${MAX_SHORT_NAME} characters or fewer`;
  if ((d.menuGroup ?? '').length > MAX_MENU_GROUP) return `Group must be ${MAX_MENU_GROUP} characters or fewer`;
  if (/[<>]/.test(`${d.shortName ?? ''}${d.menuGroup ?? ''}`)) return 'Short name and group cannot contain < or >';
  return null;
}

export interface ChangeItem { id: string; sortOrder?: number; shortName?: string | null; menuGroup?: string | null; isActive?: boolean }

const norm = (v: string | null): string | null => { const t = (v ?? '').replace(/\s+/g, ' ').trim(); return t === '' ? null : t; };

/** Only the fields that differ from the loaded data, per category that changed. */
export function computeChanges(flat: FlatCategory[], drafts: Drafts): ChangeItem[] {
  const out: ChangeItem[] = [];
  for (const c of flat) {
    const d = drafts[c.id];
    if (!d) continue;
    const item: ChangeItem = { id: c.id };
    if (d.sortOrder !== c.sortOrder) item.sortOrder = d.sortOrder;
    if (norm(d.shortName) !== c.shortName) item.shortName = norm(d.shortName);
    if (norm(d.menuGroup) !== c.menuGroup) item.menuGroup = norm(d.menuGroup);
    if (d.isActive !== c.isActive) item.isActive = d.isActive;
    if (Object.keys(item).length > 1) out.push(item);
  }
  return out;
}

export function firstError(flat: FlatCategory[], drafts: Drafts): { id: string; message: string } | null {
  for (const c of flat) {
    const e = drafts[c.id] ? validateDraft(drafts[c.id]) : null;
    if (e) return { id: c.id, message: `${c.name}: ${e}` };
  }
  return null;
}

/** Does a category match the admin's search box? (name, slug, short name, group) */
export function matchesSearch(c: FlatCategory, d: Draft | undefined, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [c.name, c.slug, d?.shortName ?? c.shortName ?? '', d?.menuGroup ?? c.menuGroup ?? ''].some((v) => v.toLowerCase().includes(t));
}

/** Valid merge targets: not itself, not one of its own subcategories, and (if it has subcategories) top-level only. */
export function mergeTargets(flat: FlatCategory[], source: FlatCategory): FlatCategory[] {
  const hasChildren = flat.some((c) => c.parentId === source.id);
  return flat
    .filter((c) => c.id !== source.id && c.parentId !== source.id && (!hasChildren || c.parentId === null))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupSuggestions(flat: FlatCategory[], parentId: string, drafts: Drafts): string[] {
  const set = new Set<string>();
  for (const c of flat) if (c.parentId === parentId) { const g = norm(drafts[c.id]?.menuGroup ?? c.menuGroup); if (g) set.add(g); }
  return [...set].sort();
}
