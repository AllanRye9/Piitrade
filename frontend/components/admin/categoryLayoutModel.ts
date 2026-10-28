/**
 * Pure helpers for Admin → Category layout (order + hide of top-level categories on buyer surfaces).
 */
import { DEFAULT_PARENT_RANK, effectiveRank } from '@/lib/categoryVisibility';

/** Working order: the admin's saved order (then the default order) for the slugs that exist, then any others. */
export function initialOrder(treeSlugs: string[], savedRank: readonly string[] | null | undefined): string[] {
  const exists = new Set(treeSlugs);
  const ranked = effectiveRank(savedRank).filter((s) => exists.has(s));
  const seen = new Set(ranked);
  return [...ranked, ...treeSlugs.filter((s) => !seen.has(s))];
}

/** The default order restricted to slugs that exist (used by "Reset to default"). */
export function defaultOrder(treeSlugs: string[]): string[] {
  return initialOrder(treeSlugs, []);
}

export function moveItem(order: string[], slug: string, delta: -1 | 1): string[] {
  const i = order.indexOf(slug);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function moveToTop(order: string[], slug: string): string[] {
  if (!order.includes(slug) || order[0] === slug) return order;
  return [slug, ...order.filter((s) => s !== slug)];
}

export function sameLayout(
  a: { order: string[]; hidden: string[] },
  b: { order: string[]; hidden: string[] },
): boolean {
  return a.order.join(',') === b.order.join(',') && [...a.hidden].sort().join(',') === [...b.hidden].sort().join(',');
}

export { DEFAULT_PARENT_RANK };
