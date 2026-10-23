import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditEntry {
  action: string; // e.g. ADMIN_ROLE_APPROVAL, USER_ROLE_CHANGE
  actorId?: string | null;
  actorEmail?: string | null;
  targetId?: string | null;
  targetEmail?: string | null;
  meta?: Record<string, unknown>;
}

/** Writes an audit row. Pass `tx` to make it atomic with the change it describes. */
export async function recordAdminAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.adminAuditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      targetId: entry.targetId ?? null,
      targetEmail: entry.targetEmail ?? null,
      meta: (entry.meta ?? {}) as Prisma.InputJsonValue,
    },
  });
  logger.info(`AUDIT ${entry.action} actor=${entry.actorId ?? '-'} target=${entry.targetId ?? '-'}`);
}
