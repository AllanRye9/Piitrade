import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { createError } from '../middleware/errorHandler';

/** Hard cap on administrator accounts. One definition, used by every route that can create an admin. */
export const MAX_ADMINS = 3;


const ADMIN_CAP_LOCK_KEY = 872_001; // arbitrary constant for pg_advisory_xact_lock

/**
 * Runs `fn` inside a transaction that holds a database-wide lock for "admin count" changes, so two
 * simultaneous promotions cannot both pass the cap check. `fn` must do its own count + write on `tx`.
 */
export async function withAdminCapLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_CAP_LOCK_KEY})`;
    return fn(tx);
  });
}

export async function assertAdminSlotFree(tx: Prisma.TransactionClient): Promise<void> {
  if ((await tx.user.count({ where: { role: 'ADMIN' } })) >= MAX_ADMINS) {
    throw createError(`Maximum admin limit reached (${MAX_ADMINS})`, 400);
  }
}
