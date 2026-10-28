/**
 * alertWorker.ts — drains the ListingAlertEvent queue and fans alert events out between instances.
 *
 *  - The DB trigger inserts an event row when a listing goes live (migration 20261024120000) and
 *    sends pg_notify('listing_active'). This worker LISTENs for that wake-up, so an alert fires
 *    within milliseconds of the listing being posted or approved.
 *  - Correctness does NOT depend on LISTEN: the worker also polls (every 30 s when LISTEN works,
 *    every 5 s when it does not — e.g. behind a transaction-mode connection pooler), and
 *    claimAlertEvents() uses FOR UPDATE SKIP LOCKED, so several instances share the work with no
 *    duplicates and a crashed worker's claim is retried after STALE_CLAIM_SECONDS.
 *  - It also LISTENs on 'alert_user' to push events other instances created into the browser
 *    streams this instance holds (see alertHub.ts).
 */
import { Client } from 'pg';
import { prisma } from './prisma';
import { logger } from './logger';
import { dispatchListingAlerts } from './listingAlerts';
import { INSTANCE_ID, publishLocal, type AlertEvent } from './alertHub';

const CLAIM_BATCH = 20;
const STALE_CLAIM_SECONDS = 120;
const MAX_ATTEMPTS = 5;
const POLL_HEALTHY_MS = 30_000;
const POLL_DEGRADED_MS = 5_000;
const PING_TIMEOUT_MS = 4_000;

export interface ClaimedEvent { id: string; listingId: string }

/** Atomically claim up to `limit` pending events (SKIP LOCKED: concurrent workers never share one). */
export async function claimAlertEvents(limit = CLAIM_BATCH): Promise<ClaimedEvent[]> {
  return prisma.$queryRaw<ClaimedEvent[]>`
    UPDATE "ListingAlertEvent" e
    SET "claimedAt" = (now() AT TIME ZONE 'UTC'), "attempts" = e."attempts" + 1
    WHERE e."id" IN (
      SELECT "id" FROM "ListingAlertEvent"
      WHERE "processedAt" IS NULL
        AND "attempts" < ${MAX_ATTEMPTS}
        AND ("claimedAt" IS NULL OR "claimedAt" < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${STALE_CLAIM_SECONDS}))
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING e."id", e."listingId"`;
}

/** Process everything pending right now. Returns how many events were completed. */
export async function processPendingAlertEvents(maxBatches = 20): Promise<number> {
  let done = 0;
  for (let b = 0; b < maxBatches; b += 1) {
    const events = await claimAlertEvents();
    if (events.length === 0) break;
    for (const ev of events) {
      try {
        await dispatchListingAlerts(ev.listingId);
        await prisma.listingAlertEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });
        done += 1;
      } catch (err) {
        // Stays claimed; retried after STALE_CLAIM_SECONDS (up to MAX_ATTEMPTS). Delivery is idempotent.
        logger.error(`Alert event ${ev.id} (listing ${ev.listingId}) failed: ${String(err)}`);
      }
    }
  }
  return done;
}

/** Housekeeping: drop finished (or permanently failed) events older than `days`. */
export async function purgeOldAlertEvents(days = 3): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const r = await prisma.listingAlertEvent.deleteMany({
    where: { createdAt: { lt: cutoff }, OR: [{ processedAt: { not: null } }, { attempts: { gte: MAX_ATTEMPTS } }] },
  });
  return r.count;
}

function connectionString(): string {
  const raw = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL || '';
  return raw.startsWith('postgres://') ? raw.replace('postgres://', 'postgresql://') : raw;
}

let listening = false;
/** True while a LISTEN connection is up AND a self-test notification round-tripped. */
export function isAlertListenerHealthy(): boolean { return listening; }

export interface AlertWorkerHandle {
  stop(): Promise<void>;
  /** Run a drain now (what a NOTIFY or the poll timer does). Resolves when it finishes. */
  kick(): Promise<void>;
}

export function startAlertWorker(): AlertWorkerHandle {
  let stopped = false;
  let client: Client | null = null;
  let backoff = 1_000;
  let pollTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let processing = false;
  let again = false;
  let pingWaiter: (() => void) | null = null;

  const kick = async (): Promise<void> => {
    if (processing) { again = true; return; }
    processing = true;
    try {
      do { again = false; await processPendingAlertEvents(); } while (again && !stopped);
    } catch (err) {
      logger.error(`Alert worker pass failed: ${String(err)}`);
    } finally {
      processing = false;
    }
  };

  const schedulePoll = () => {
    if (stopped) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => { await kick(); schedulePoll(); }, listening ? POLL_HEALTHY_MS : POLL_DEGRADED_MS);
    pollTimer.unref?.();
  };

  const onDrop = (why: string) => {
    if (client) { client.removeAllListeners(); client.end().catch(() => undefined); client = null; }
    const wasListening = listening;
    listening = false;
    if (wasListening) logger.warn(`Alert listener disconnected (${why}); polling every ${POLL_DEGRADED_MS / 1000}s until it reconnects`);
    schedulePoll();
    if (stopped) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, backoff);
    retryTimer.unref?.();
    backoff = Math.min(backoff * 2, 30_000);
  };

  async function connect(): Promise<void> {
    if (stopped) return;
    const c = new Client({ connectionString: connectionString(), keepAlive: true });
    c.on('error', (e) => onDrop(`error: ${e.message}`));
    c.on('end', () => onDrop('connection ended'));
    c.on('notification', (msg) => {
      try {
        if (msg.channel === 'listing_active') { void kick(); return; }
        if (msg.channel === 'alert_ping') { if (msg.payload === INSTANCE_ID && pingWaiter) pingWaiter(); return; }
        if (msg.channel === 'alert_user' && msg.payload) {
          const data = JSON.parse(msg.payload) as { o: string; userId: string; event: AlertEvent };
          if (data.o !== INSTANCE_ID) publishLocal(data.userId, data.event);
        }
      } catch (err) {
        logger.warn(`Bad alert notification: ${String(err)}`);
      }
    });
    try {
      await c.connect();
      await c.query('LISTEN listing_active');
      await c.query('LISTEN alert_user');
      await c.query('LISTEN alert_ping');
      client = c;
      // Self-test: some poolers accept LISTEN but never deliver. Wait for our own ping to come back.
      const gotPing = new Promise<boolean>((resolve) => {
        const t = setTimeout(() => { pingWaiter = null; resolve(false); }, PING_TIMEOUT_MS);
        t.unref?.();
        pingWaiter = () => { clearTimeout(t); pingWaiter = null; resolve(true); };
      });
      await prisma.$executeRaw`SELECT pg_notify('alert_ping', ${INSTANCE_ID})`;
      if (await gotPing) {
        listening = true;
        backoff = 1_000;
        logger.info('Alert listener connected (instant alerts on)');
      } else {
        logger.warn('Alert listener connected but LISTEN/NOTIFY did not round-trip (transaction-mode pooler?). Alerts still work via polling every 5s; use a direct DATABASE_URL for instant delivery.');
        listening = false;
      }
      schedulePoll();
      void kick(); // anything that arrived while we were not listening
    } catch (err) {
      logger.warn(`Alert listener could not connect: ${String(err)}`);
      onDrop('connect failed');
    }
  }

  schedulePoll();
  void connect();
  void kick();

  return {
    kick,
    async stop() {
      stopped = true;
      listening = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (client) { client.removeAllListeners(); await client.end().catch(() => undefined); client = null; }
    },
  };
}
