/**
 * webPush.ts — Web Push (VAPID) delivery to a user's registered browsers/devices.
 *
 * Disabled (every function is a harmless no-op) until VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set.
 * Generate a pair once with:  npx web-push generate-vapid-keys
 */
import webpush from 'web-push';
import { prisma } from './prisma';
import { logger } from './logger';

export interface PushPayload {
  title: string;
  body: string;
  /** Site-relative path opened when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other instead of stacking. */
  tag?: string;
}

export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const MAX_BODY = 160;
const MAX_TITLE = 80;

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

let vapidApplied = false;
function ensureVapid(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidApplied) {
    const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@piitrade.com';
    webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY!.trim(), process.env.VAPID_PRIVATE_KEY!.trim());
    vapidApplied = true;
  }
  return true;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The JSON the service worker (public/sw.js) receives. Kept small — push services cap payloads at ~4 KB. */
export function buildPushBody(p: PushPayload): string {
  return JSON.stringify({
    title: clip(p.title, MAX_TITLE),
    body: clip(p.body, MAX_BODY),
    url: p.url.startsWith('/') ? p.url : '/notifications',
    tag: p.tag,
  });
}

/** A push service answers 404/410 when the subscription is gone for good (uninstalled, revoked). */
export function isGoneStatus(status: unknown): boolean {
  return status === 404 || status === 410;
}

/** Sends to the given subscriptions; prunes dead ones. Returns how many deliveries the push service accepted. */
export async function sendPush(subs: StoredSubscription[], payload: PushPayload): Promise<{ sent: number; failed: number; removed: number }> {
  const out = { sent: 0, failed: 0, removed: 0 };
  if (!subs.length || !ensureVapid()) return out;
  const body = buildPushBody(payload);

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 24 * 60 * 60, urgency: 'normal', timeout: 8000 },
      );
      out.sent += 1;
      await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSuccessAt: new Date() } }).catch(() => { /* row may have been removed */ });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (isGoneStatus(status)) {
        out.removed += 1;
        await prisma.pushSubscription.deleteMany({ where: { id: sub.id } }).catch(() => { /* already gone */ });
      } else {
        out.failed += 1;
        logger.warn(`Web push failed (status ${status ?? 'n/a'}): ${(err as Error).message}`);
      }
    }
  }));
  return out;
}
