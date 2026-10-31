/**
 * imageSubmission.ts — moves a seller's photos from "private, screened" to "visible to the admin queue" at the
 * moment the ad is posted/saved, and cleans up photos that were uploaded but never used.
 */
import { prisma } from './prisma';
import { deleteFromCDN } from './cdn';
import { logger } from './logger';

const DAY_MS = 24 * 60 * 60 * 1000;
export const ABANDONED_AFTER_MS = 3 * DAY_MS;

export async function markImagesSubmitted(userId: string, opts: { ids?: string[]; urls?: string[]; listingId?: string }): Promise<void> {
  const ids = (opts.ids ?? []).filter(Boolean);
  const urls = (opts.urls ?? []).filter(Boolean);
  if (ids.length === 0 && urls.length === 0) return;
  await prisma.productImage.updateMany({
    where: { sellerId: userId, submittedAt: null, OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(urls.length ? [{ cdnUrl: { in: urls } }] : [])] },
    data: { submittedAt: new Date(), ...(opts.listingId ? { listingId: opts.listingId } : {}) },
  });
}

/** Deletes screened-but-never-posted uploads older than three days (record + stored file). */
export async function purgeAbandonedUploads(now = new Date()): Promise<number> {
  const stale = await prisma.productImage.findMany({
    where: { submittedAt: null, listingId: null, uploadedAt: { lt: new Date(now.getTime() - ABANDONED_AFTER_MS) } },
    select: { id: true, cdnUrl: true },
    take: 200,
  });
  let n = 0;
  for (const img of stale) {
    try {
      if (img.cdnUrl) await deleteFromCDN(img.cdnUrl);
      await prisma.productImage.delete({ where: { id: img.id } });
      n++;
    } catch (err) {
      logger.warn(`Could not purge abandoned upload ${img.id}: ${String(err)}`);
    }
  }
  return n;
}
