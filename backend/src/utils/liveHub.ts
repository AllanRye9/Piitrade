/**
 * liveHub.ts — pushes "something changed" to open browsers the instant it happens.
 *
 *   Postgres trigger ─ pg_notify('data_changed', topic) ─▶ this LISTEN connection ─▶ SSE ─▶ browser
 *
 * The event carries NO data, only the topic names that changed; the browser then re-reads through the
 * normal API, so permissions stay enforced there. Bursts are coalesced (at most one event per topic per
 * THROTTLE_MS: the first goes out immediately, the rest are merged into one trailing event).
 *
 * Resilience: if LISTEN cannot connect or does not round-trip (transaction-mode poolers), the hub
 * switches to "degraded" mode and broadcasts a tick every DEGRADED_TICK_MS so pages still refresh
 * quickly. Every instance LISTENs on its own, so no cross-instance relay is needed.
 */
import type { Response } from 'express';
import { Client } from 'pg';
import { prisma } from './prisma';
import { logger } from './logger';
import { INSTANCE_ID } from './alertHub';

export type LiveTopic = 'listings' | 'clicks';
const TOPICS: readonly LiveTopic[] = ['listings', 'clicks'];

export const MAX_LIVE_STREAMS_TOTAL = 5_000;
export const MAX_LIVE_STREAMS_PER_USER = 5;
const THROTTLE_MS = 150;
const DEGRADED_TICK_MS = 5_000;
const PING_TIMEOUT_MS = 4_000;

interface LiveClient { res: Response; topics: Set<LiveTopic>; key: string }
const clients = new Set<LiveClient>();
const perKey = new Map<string, number>();

export function liveStreamCount(): number { return clients.size; }

/** Registers a stream. Returns false when a limit is hit (the browser then falls back to slow polling). */
export function addLiveClient(res: Response, topics: LiveTopic[], key: string): (() => void) | null {
  if (clients.size >= MAX_LIVE_STREAMS_TOTAL) return null;
  if (key.startsWith('u:') && (perKey.get(key) ?? 0) >= MAX_LIVE_STREAMS_PER_USER) return null;
  const c: LiveClient = { res, topics: new Set(topics), key };
  clients.add(c);
  perKey.set(key, (perKey.get(key) ?? 0) + 1);
  return () => {
    if (!clients.delete(c)) return;
    const n = (perKey.get(key) ?? 1) - 1;
    if (n <= 0) perKey.delete(key); else perKey.set(key, n);
  };
}

function send(topics: LiveTopic[]): void {
  if (topics.length === 0) return;
  const frame = `event: change\ndata: ${JSON.stringify({ topics, t: Date.now() })}\n\n`;
  for (const c of clients) {
    if (!topics.some((t) => c.topics.has(t))) continue;
    try { c.res.write(frame); } catch { /* closed: its cleanup removes it */ }
  }
}

const lastSent: Record<string, number> = {};
const pending = new Set<LiveTopic>();
let trailing: NodeJS.Timeout | null = null;

/** Leading + trailing throttle: the first change goes out at once, a burst is merged into one more event. */
export function publishChange(topicList: string[]): void {
  const now = Date.now();
  const immediate: LiveTopic[] = [];
  for (const t of topicList) {
    if (!(TOPICS as readonly string[]).includes(t)) continue;
    const topic = t as LiveTopic;
    if (now - (lastSent[topic] ?? 0) >= THROTTLE_MS) { lastSent[topic] = now; immediate.push(topic); }
    else pending.add(topic);
  }
  send(immediate);
  if (pending.size > 0 && !trailing) {
    trailing = setTimeout(() => {
      trailing = null;
      const batch = [...pending];
      pending.clear();
      for (const t of batch) lastSent[t] = Date.now();
      send(batch);
    }, THROTTLE_MS);
    trailing.unref?.();
  }
}

function connectionString(): string {
  const raw = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL || '';
  return raw.startsWith('postgres://') ? raw.replace('postgres://', 'postgresql://') : raw;
}

let healthy = false;
export function isLiveListenerHealthy(): boolean { return healthy; }

export function startLiveListener(): { stop(): Promise<void> } {
  let stopped = false;
  let client: Client | null = null;
  let backoff = 1_000;
  let retryTimer: NodeJS.Timeout | null = null;
  let tickTimer: NodeJS.Timeout | null = null;
  let pingWaiter: (() => void) | null = null;

  // Degraded mode: no working LISTEN, so tell every page to re-check every few seconds.
  const syncTick = () => {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (!healthy && !stopped) {
      tickTimer = setInterval(() => publishChange([...TOPICS]), DEGRADED_TICK_MS);
      tickTimer.unref?.();
    }
  };

  const onDrop = (why: string) => {
    if (client) { client.removeAllListeners(); client.end().catch(() => undefined); client = null; }
    if (healthy) logger.warn(`Live-update listener disconnected (${why}); pages re-check every ${DEGRADED_TICK_MS / 1000}s until it reconnects`);
    healthy = false;
    syncTick();
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
      if (msg.channel === 'live_ping') { if (msg.payload === INSTANCE_ID && pingWaiter) pingWaiter(); return; }
      if (msg.channel === 'data_changed' && msg.payload) publishChange(msg.payload.split(','));
    });
    try {
      await c.connect();
      await c.query('LISTEN data_changed');
      await c.query('LISTEN live_ping');
      client = c;
      const gotPing = new Promise<boolean>((resolve) => {
        const t = setTimeout(() => { pingWaiter = null; resolve(false); }, PING_TIMEOUT_MS);
        t.unref?.();
        pingWaiter = () => { clearTimeout(t); pingWaiter = null; resolve(true); };
      });
      await prisma.$executeRaw`SELECT pg_notify('live_ping', ${INSTANCE_ID})`;
      if (await gotPing) {
        healthy = true;
        backoff = 1_000;
        logger.info('Live-update listener connected (pages refresh instantly)');
      } else {
        healthy = false;
        logger.warn('Live-update listener connected but LISTEN/NOTIFY did not round-trip (transaction-mode pooler?). Pages refresh every 5s instead; use a direct DATABASE_URL for instant updates.');
      }
      syncTick();
      publishChange([...TOPICS]); // anything that changed while we were not listening
    } catch (err) {
      logger.warn(`Live-update listener could not connect: ${String(err)}`);
      onDrop('connect failed');
    }
  }

  syncTick();
  void connect();

  return {
    async stop() {
      stopped = true;
      healthy = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (tickTimer) clearInterval(tickTimer);
      if (client) { client.removeAllListeners(); await client.end().catch(() => undefined); client = null; }
    },
  };
}
