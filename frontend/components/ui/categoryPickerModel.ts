/**
 * Pure model for CategoryPicker: flat option list, search, and recent picks.
 * The picker is a SELLER surface, so nothing here is count-gated: every category is selectable.
 */
import type { Category } from '@/lib/types';
import { findSynonymSlugs } from '@/lib/categorySynonyms';

export interface PickerOption {
  id: string;
  slug: string;
  /** Own name, e.g. "Boda Boda & Delivery Bikes" */
  name: string;
  icon?: string;
  /** Parent name for subcategories, "" for top-level categories */
  parentName: string;
  /** true for a top-level category (selecting it means "all of it") */
  isParent: boolean;
  /** "Parent › Child" for children, own name for parents */
  label: string;
}

export const RECENT_KEY = 'piitrade_recent_categories';
export const MAX_RECENTS = 5;
export const MAX_RESULTS = 30;

export function flattenOptions(categories: Category[]): PickerOption[] {
  const out: PickerOption[] = [];
  for (const p of categories) {
    out.push({ id: p.id, slug: p.slug, name: p.name, icon: p.icon, parentName: '', isParent: true, label: p.name });
    for (const c of p.children ?? []) {
      out.push({ id: c.id, slug: c.slug, name: c.name, icon: c.icon ?? p.icon, parentName: p.name, isParent: false, label: `${p.name} › ${c.name}` });
    }
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Search by name, "Parent › Child" label, or shared synonym ("boda", "mivumba", "fundi").
 * Best matches first: exact name, name prefix, word-start, contains, synonym. Capped at MAX_RESULTS.
 */
export function searchOptions(categories: Category[], query: string): PickerOption[] {
  const q = norm(query);
  if (q.length < 1) return [];
  const synonymSlugs = new Set(findSynonymSlugs(q));
  const scored: { o: PickerOption; score: number; i: number }[] = [];
  flattenOptions(categories).forEach((o, i) => {
    const name = norm(o.name);
    const label = norm(o.label);
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(/[\s,&()/-]+/).some((w) => w.startsWith(q))) score = 2;
    else if (label.includes(q)) score = 3;
    else if (synonymSlugs.has(o.slug)) score = 4;
    if (score >= 0) scored.push({ o, score, i });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, MAX_RESULTS)
    .map((x) => x.o);
}

/** Recent picks that still exist in the tree, most recent first. */
export function resolveRecents(categories: Category[], ids: string[]): PickerOption[] {
  const byId = new Map(flattenOptions(categories).map((o) => [o.id, o]));
  return ids.map((id) => byId.get(id)).filter((o): o is PickerOption => !!o).slice(0, MAX_RECENTS);
}

export function addRecent(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, MAX_RECENTS);
}

export function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function writeRecents(ids: string[]): void {
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS))); } catch { /* storage may be unavailable */ }
}
