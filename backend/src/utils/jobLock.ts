import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Runs `fn` only if no other app instance is running a job with the same `name`. A Postgres
 * transaction-level advisory lock is held for the duration, so the lock is released automatically
 * if this process dies and works through connection poolers (unlike session-level locks).
 * Returns false when another instance already holds it (the tick is simply skipped).
 *
 * Intended for the scheduled background jobs: with several instances running, each would otherwise
 * repeat the same sweeps and send duplicate reminders.
 */
export async function runExclusive(name: string, fn: () => Promise<unknown>, maxMs = 10 * 60 * 1000): Promise<boolean> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`piitrade-job:${name}`})) AS locked`;
        if (!rows[0]?.locked) return false;
        await fn();
        return true;
      },
      { maxWait: 5_000, timeout: maxMs },
    );
  } catch (err) {
    logger.error(`Job "${name}" failed under lock`, err);
    return false;
  }
}
