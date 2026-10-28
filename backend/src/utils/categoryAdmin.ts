/**
 * categoryAdmin.ts — admin-side rules for the Phase 2 category structure fields and for merging
 * one category into another.
 *
 * Display fields (all optional on every write; unknown keys are ignored):
 *   sortOrder  integer, lower first among siblings
 *   shortName  <= 24 chars (tiles, chips, menus); "" / null clears it
 *   menuGroup  <= 40 chars (heading on category pages);   "" / null clears it
 *   isActive   false retires a category: hidden everywhere and not offered for new listings
 */
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { recordAdminAudit } from './adminAudit';
import { createError } from '../middleware/errorHandler';

export const MAX_SHORT_NAME = 24;
export const MAX_MENU_GROUP = 40;
export const MAX_SORT_ORDER = 100_000;
export const MAX_BATCH = 500;

export interface DisplayPatch {
  sortOrder?: number;
  shortName?: string | null;
  menuGroup?: string | null;
  isActive?: boolean;
}

export function parseDisplayPatch(input: unknown): { patch: DisplayPatch } | { error: string } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const patch: DisplayPatch = {};

  if (src.sortOrder !== undefined) {
    const n = src.sortOrder;
    if (typeof n !== 'number' || !Number.isInteger(n) || Math.abs(n) > MAX_SORT_ORDER) {
      return { error: `sortOrder must be a whole number between -${MAX_SORT_ORDER} and ${MAX_SORT_ORDER}` };
    }
    patch.sortOrder = n;
  }
  for (const [key, max] of [['shortName', MAX_SHORT_NAME], ['menuGroup', MAX_MENU_GROUP]] as const) {
    const v = src[key];
    if (v === undefined) continue;
    if (v === null) { patch[key] = null; continue; }
    if (typeof v !== 'string') return { error: `${key} must be text` };
    const t = v.replace(/\s+/g, ' ').trim();
    if (t.length > max) return { error: `${key} must be ${max} characters or fewer` };
    if (/[<>]/.test(t)) return { error: `${key} cannot contain < or >` };
    patch[key] = t === '' ? null : t;
  }
  if (src.isActive !== undefined) {
    if (typeof src.isActive !== 'boolean') return { error: 'isActive must be true or false' };
    patch.isActive = src.isActive;
  }
  return { patch };
}

export interface MergeResult {
  movedListings: number;
  movedChildren: number;
  updatedAlerts: number;
  sourceSlug: string;
  targetSlug: string;
}

/**
 * Merge `sourceId` into `targetId`, atomically:
 *  - every listing in the source moves to the target,
 *  - the source's subcategories move to the target (only if the target is a top-level category,
 *    because the tree is two levels deep),
 *  - saved searches / alerts that filter on the source slug are re-pointed to the target slug,
 *  - the source category is deleted.
 * Nothing else is touched. Throws a 4xx error for impossible merges.
 */
export async function mergeCategories(
  sourceId: string,
  targetId: string,
  actor: { id?: string | null; email?: string | null } = {},
): Promise<MergeResult> {
  if (!sourceId || !targetId) throw createError('sourceId and targetId are required', 400);
  if (sourceId === targetId) throw createError('Choose a different category to merge into', 400);

  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.category.findUnique({ where: { id: sourceId }, include: { _count: { select: { children: true } } } }),
      tx.category.findUnique({ where: { id: targetId } }),
    ]);
    if (!source) throw createError('Category to merge was not found', 404);
    if (!target) throw createError('Merge target was not found', 404);
    if (target.parentId === source.id) {
      throw createError('The target is a subcategory of the category being merged. Pick a different target.', 400);
    }
    const hasChildren = source._count.children > 0;
    if (hasChildren && target.parentId !== null) {
      throw createError('This category has subcategories and the target is a subcategory itself. Merge into a top-level category or move the subcategories first.', 400);
    }

    const movedChildren = hasChildren
      ? (await tx.category.updateMany({ where: { parentId: source.id }, data: { parentId: target.id } })).count
      : 0;
    const movedListings = (await tx.listing.updateMany({ where: { categoryId: source.id }, data: { categoryId: target.id } })).count;
    const updatedAlerts = Number(await tx.$executeRaw`
      UPDATE "SavedSearch"
      SET "categorySlug" = ${target.slug},
          "filters" = jsonb_set(COALESCE("filters", '{}'::jsonb), '{category}', to_jsonb(${target.slug}::text))
      WHERE "categorySlug" = ${source.slug} OR "filters"->>'category' = ${source.slug}`);
    await tx.category.delete({ where: { id: source.id } });

    await recordAdminAudit({
      action: 'CATEGORY_MERGE',
      actorId: actor.id ?? null,
      actorEmail: actor.email ?? null,
      targetId: source.id,
      meta: { sourceSlug: source.slug, targetSlug: target.slug, movedListings, movedChildren, updatedAlerts },
    }, tx as Prisma.TransactionClient);

    return { movedListings, movedChildren, updatedAlerts, sourceSlug: source.slug, targetSlug: target.slug };
  });
}
