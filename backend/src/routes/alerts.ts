import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { addStream, removeStream, type AlertEvent } from '../utils/alertHub';
import { sanitizeParams, hasAnyFilter, buildSavedSearchWhere } from '../utils/savedSearches';

/**
 * /api/alerts — the browser side of instant alerts.
 *   GET  /stream   Server-Sent Events: each matching listing is pushed the moment it is posted.
 *   GET  /recent   Poll fallback / catch-up (what the stream would have sent since `since`).
 *   GET  /feed     The profile page: alert notifications, newest first, with unread counts.
 *   POST /feed/read  Mark alert notifications read.
 *   POST /preview  "How many live listings match these criteria right now?" for the alert form.
 */
const router = Router();
router.use(authenticate);

const STREAM_MAX_AGE_MS = 30 * 60_000; // the client reconnects (and re-authenticates) every 30 min
const HEARTBEAT_MS = 25_000;

interface NotificationRow {
  id: string; title: string; message: string; read: boolean; createdAt: Date; data: unknown;
}

export function toAlertEvent(n: NotificationRow): AlertEvent {
  const d = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
  return {
    id: n.id,
    listingId: typeof d.listingId === 'string' ? d.listingId : '',
    alertName: typeof d.alertName === 'string' ? d.alertName : '',
    title: n.title,
    message: n.message,
    // same-site paths only ("//host" is protocol-relative = external)
    href: typeof d.href === 'string' && /^\/(?![/\\])/.test(d.href) ? d.href : '/profile/alerts',
    image: typeof d.image === 'string' ? d.image : null,
    sound: d.sound !== false,
    createdAt: n.createdAt.toISOString(),
  };
}

router.get('/stream', (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  if (!addStream(userId, res)) {
    res.status(429).json({ message: 'Too many open alert streams. Close another tab and retry.' });
    return;
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx-style proxies not to buffer the stream
  });
  res.flushHeaders();
  res.write('retry: 5000\n: connected\n\n');
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
  const maxAge = setTimeout(() => { try { res.end(); } catch { /* closed */ } }, STREAM_MAX_AGE_MS);
  heartbeat.unref?.();
  maxAge.unref?.();
  const cleanup = () => { clearInterval(heartbeat); clearTimeout(maxAge); removeStream(userId, res); };
  req.on('close', cleanup);
  res.on('error', cleanup);
});

router.get('/recent', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const since = typeof req.query.since === 'string' ? new Date(req.query.since) : null;
    const now = new Date();
    // No/invalid `since`: only look back 2 minutes so a first poll never replays old alerts.
    const from = since && !Number.isNaN(since.getTime()) ? since : new Date(now.getTime() - 2 * 60_000);
    const rows = await prisma.notification.findMany({
      where: { userId: req.user!.userId, type: 'LISTING_ALERT', createdAt: { gt: from } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    res.json({ events: rows.map(toAlertEvent), now: now.toISOString() });
  } catch (err) { next(err); }
});

router.get('/feed', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 50);
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    const where = { userId, type: 'LISTING_ALERT' as const };
    const [rows, total, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, read: false } }),
    ]);
    res.json({
      items: rows.map((n) => ({ ...toAlertEvent(n), isRead: n.read })),
      total, unread, page, pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) { next(err); }
});

router.post('/feed/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 100) : null;
    const r = await prisma.notification.updateMany({
      where: { userId: req.user!.userId, type: 'LISTING_ALERT', read: false, ...(ids ? { id: { in: ids } } : {}) },
      data: { read: true },
    });
    res.json({ updated: r.count });
  } catch (err) { next(err); }
});

router.post('/preview', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const params = sanitizeParams(req.body?.params);
    if (!hasAnyFilter(params)) return next(createError('Add a keyword or a filter to preview matches', 400));
    const where = buildSavedSearchWhere(params, new Date());
    const [count, samples] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({ where, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, title: true, price: true, currency: true } }),
    ]);
    res.json({ count, samples, params });
  } catch (err) { next(err); }
});

export default router;
