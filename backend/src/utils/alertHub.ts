/**
 * alertHub.ts — in-process registry of open alert streams (Server-Sent Events) plus the cross-instance
 * fan-out.
 *
 * Flow: when an alert fires, `publishAlertEvent` (1) writes it to every stream this process holds for
 * the user and (2) sends pg_notify('alert_user', …) so OTHER server instances (which LISTEN, see
 * alertWorker.ts) write it to the streams they hold. The browser de-duplicates on `id`, so an event
 * that arrives twice is shown once. If LISTEN is unavailable the browser's poll of GET /alerts/recent
 * (DB-backed) still picks the alert up within seconds.
 */
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from './prisma';
import { logger } from './logger';

export const INSTANCE_ID = randomUUID();
export const MAX_STREAMS_PER_USER = 5;
export const MAX_STREAMS_TOTAL = 5_000;

/** What the browser receives (also what GET /alerts/recent returns). */
export interface AlertEvent {
  /** Notification id — the client de-duplicates on this. */
  id: string;
  listingId: string;
  alertName: string;
  title: string;
  message: string;
  href: string;
  image: string | null;
  /** Play a sound for this one (the alert's own setting; the browser can still mute). */
  sound: boolean;
  createdAt: string;
}

const streams = new Map<string, Set<Response>>();
let total = 0;

export function addStream(userId: string, res: Response): boolean {
  if (total >= MAX_STREAMS_TOTAL) return false;
  const set = streams.get(userId) ?? new Set<Response>();
  if (set.size >= MAX_STREAMS_PER_USER) return false;
  set.add(res);
  streams.set(userId, set);
  total += 1;
  return true;
}

export function removeStream(userId: string, res: Response): void {
  const set = streams.get(userId);
  if (!set || !set.delete(res)) return;
  total -= 1;
  if (set.size === 0) streams.delete(userId);
}

export function streamCount(userId?: string): number {
  return userId ? streams.get(userId)?.size ?? 0 : total;
}

export function sseFrame(event: AlertEvent): string {
  return `id: ${event.id}\nevent: alert\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Write to this process's streams for the user. Returns how many streams received it. */
export function publishLocal(userId: string, event: AlertEvent): number {
  const set = streams.get(userId);
  if (!set) return 0;
  const frame = sseFrame(event);
  let n = 0;
  for (const res of set) {
    try { res.write(frame); n += 1; } catch { /* a dead socket is removed by its 'close' handler */ }
  }
  return n;
}

/** Deliver to this instance and tell the others. Never throws: a failed fan-out must not fail an alert. */
export async function publishAlertEvent(userId: string, event: AlertEvent): Promise<void> {
  publishLocal(userId, event);
  try {
    const payload = JSON.stringify({ o: INSTANCE_ID, userId, event });
    // pg_notify payloads are limited to ~8000 bytes; an event is a few hundred.
    if (payload.length < 7_500) await prisma.$executeRaw`SELECT pg_notify('alert_user', ${payload})`;
  } catch (err) {
    logger.warn(`Alert fan-out (pg_notify) failed: ${String(err)}`);
  }
}

/** Test helper. */
export function _resetHubForTests(): void { streams.clear(); total = 0; }
