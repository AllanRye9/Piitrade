import { prisma } from './prisma';
import { logger } from './logger';

/**
 * If no primary admin exists yet (a fresh install, or the primary account was removed), the earliest-created admin
 * becomes primary. Safe to call repeatedly and concurrently: the partial unique index allows at most one primary.
 */
export async function ensurePrimaryAdmin(): Promise<void> {
  try {
    const existing = await prisma.user.findFirst({ where: { role: 'ADMIN', isPrimaryAdmin: true }, select: { id: true } });
    if (existing) return;
    const first = await prisma.user.findFirst({ where: { role: 'ADMIN', isBanned: false }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    if (!first) return;
    await prisma.user.updateMany({ where: { id: first.id, isPrimaryAdmin: false }, data: { isPrimaryAdmin: true } });
    logger.info(`Primary admin elected: ${first.id}`);
  } catch (err) {
    // A concurrent election hitting the unique index is fine; anything else is logged, never fatal.
    logger.warn(`ensurePrimaryAdmin: ${(err as Error).message}`);
  }
}
