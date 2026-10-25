import crypto from 'crypto';
import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { hashToken } from '../utils/tokenHash';
import { safeEqual } from '../utils/safeEqual';
import { normalizeUserPhone } from '../utils/phone';
import { getVapidPublicKey, isPushConfigured, sendPush } from '../utils/webPush';
import { isWhatsAppConfigured, sendWhatsAppVerificationCode } from '../utils/whatsapp';

/**
 * /api/push — alert settings: browser push subscriptions, WhatsApp number verification, and the
 * "chat message alerts" switch. Delivery itself lives in utils/notificationDispatch.ts.
 */
const router = Router();
router.use(authenticate);

const keyByUser = (req: unknown) => (req as AuthRequest).user?.userId ?? 'anon';
const limiter = (max: number, message: string) => rateLimit({
  windowMs: 60 * 1000, max, standardHeaders: true, legacyHeaders: false, keyGenerator: keyByUser, message: { message },
});
const writeLimiter = limiter(20, 'Too many requests. Please wait a minute.');
const testLimiter = limiter(3, 'Please wait a minute before sending another test.');

const MAX_SUBSCRIPTIONS_PER_USER = 10;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MIN_GAP_MS = 60 * 1000;
const CODE_MAX_PER_HOUR = 5;
const CODE_MAX_ATTEMPTS = 5;

export function maskNumber(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 7) return '•••';
  return `+${digits.slice(0, 3)}${'•'.repeat(Math.max(3, digits.length - 6))}${digits.slice(-3)}`;
}

/** Validates the browser's PushSubscription JSON (never trust the client's shape). */
export function parseSubscription(raw: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const { endpoint } = s;
  const p256dh = s.keys?.p256dh;
  const auth = s.keys?.auth;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{20,200}={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]{10,64}={0,2}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

// GET /api/push/settings — everything the settings card needs in one call
router.get('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const [prefs, devices] = await Promise.all([
      prisma.notificationPreference.findUnique({ where: { userId } }),
      prisma.pushSubscription.count({ where: { userId } }),
    ]);
    res.set('Cache-Control', 'private, no-store');
    res.json({
      push: { available: isPushConfigured(), publicKey: getVapidPublicKey(), devices },
      whatsapp: {
        available: isWhatsAppConfigured(),
        verified: Boolean(prefs?.whatsappVerifiedAt),
        number: prefs?.whatsappVerifiedAt ? maskNumber(prefs.whatsappNumber) : null,
        pendingVerification: Boolean(!prefs?.whatsappVerifiedAt && prefs?.whatsappCodeHash && prefs.whatsappCodeExpiresAt && prefs.whatsappCodeExpiresAt > new Date()),
      },
      notifyMessages: prefs?.notifyMessages ?? true,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/push/settings  { notifyMessages: boolean }
router.put('/settings', writeLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { notifyMessages } = (req.body ?? {}) as { notifyMessages?: unknown };
    if (typeof notifyMessages !== 'boolean') return next(createError('notifyMessages must be true or false', 400));
    const userId = req.user!.userId;
    await prisma.notificationPreference.upsert({ where: { userId }, create: { userId, notifyMessages }, update: { notifyMessages } });
    res.json({ notifyMessages });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/subscribe  { subscription: PushSubscriptionJSON, userAgent? }
router.post('/subscribe', writeLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isPushConfigured()) return next(createError('Push notifications are not available yet', 503));
    const body = (req.body ?? {}) as { subscription?: unknown; userAgent?: unknown };
    const sub = parseSubscription(body.subscription);
    if (!sub) return next(createError('Invalid push subscription', 400));
    const userId = req.user!.userId;
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 300) : null;

    // The endpoint identifies a browser profile; if someone else logged in there before, it now belongs to this account.
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent },
      update: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent },
    });

    const all = await prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (all.length > MAX_SUBSCRIPTIONS_PER_USER) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: all.slice(MAX_SUBSCRIPTIONS_PER_USER).map((s) => s.id) } } });
    }
    res.status(201).json({ subscribed: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/unsubscribe  { endpoint }
router.post('/unsubscribe', writeLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { endpoint } = (req.body ?? {}) as { endpoint?: unknown };
    if (typeof endpoint !== 'string' || !endpoint) return next(createError('endpoint is required', 400));
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user!.userId } });
    res.json({ subscribed: false });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/test — sends a real push to this user's devices so they can confirm it works
router.post('/test', testLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isPushConfigured()) return next(createError('Push notifications are not available yet', 503));
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: req.user!.userId }, select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (!subs.length) return next(createError('No device is subscribed yet', 400));
    const r = await sendPush(subs, { title: 'Piitrade alerts are on 🔔', body: 'You will get new messages and offers here.', url: '/notifications', tag: 'push-test' });
    res.json({ sent: r.sent, failed: r.failed });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/whatsapp/send-code  { phone } — texts a 6-digit code to the number via WhatsApp
router.post('/whatsapp/send-code', limiter(5, 'Too many requests. Please wait a minute.'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isWhatsAppConfigured()) return next(createError('WhatsApp alerts are not available yet', 503));
    const userId = req.user!.userId;
    const number = normalizeUserPhone((req.body ?? {}).phone);
    if (!number) return next(createError('Enter your WhatsApp number', 400));

    const now = new Date();
    const recent = await prisma.notificationDelivery.findMany({
      where: { userId, channel: 'WHATSAPP_CODE', createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
      orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    if (recent.length >= CODE_MAX_PER_HOUR) return next(createError('Too many codes requested. Please try again in an hour.', 429));
    if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < CODE_MIN_GAP_MS) {
      return next(createError('A code was just sent. Please wait a minute before requesting another.', 429));
    }

    const code = String(crypto.randomInt(100000, 1000000));
    await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, whatsappNumber: number, whatsappCodeHash: hashToken(`${userId}:${code}`), whatsappCodeExpiresAt: new Date(now.getTime() + CODE_TTL_MS), whatsappCodeAttempts: 0 },
      update: { whatsappNumber: number, whatsappVerifiedAt: null, whatsappCodeHash: hashToken(`${userId}:${code}`), whatsappCodeExpiresAt: new Date(now.getTime() + CODE_TTL_MS), whatsappCodeAttempts: 0 },
    });

    const result = await sendWhatsAppVerificationCode(number, code);
    await prisma.notificationDelivery.create({
      data: { userId, channel: 'WHATSAPP_CODE', status: result.ok ? 'SENT' : 'FAILED', detail: result.error?.slice(0, 300) },
    });
    if (!result.ok) return next(createError('We could not send the code to that number. Check it and try again.', 502));
    res.json({ sent: true, expiresInMinutes: CODE_TTL_MS / 60000, number: maskNumber(number) });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/whatsapp/verify  { code }
router.post('/whatsapp/verify', limiter(10, 'Too many attempts. Please wait a minute.'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { code } = (req.body ?? {}) as { code?: unknown };
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return next(createError('Enter the 6-digit code', 400));

    const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (!prefs?.whatsappCodeHash || !prefs.whatsappCodeExpiresAt || prefs.whatsappCodeExpiresAt <= new Date()) {
      return next(createError('That code has expired. Request a new one.', 400));
    }
    if (prefs.whatsappCodeAttempts >= CODE_MAX_ATTEMPTS) return next(createError('Too many wrong attempts. Request a new code.', 429));

    if (!safeEqual(hashToken(`${userId}:${code.trim()}`), prefs.whatsappCodeHash)) {
      await prisma.notificationPreference.update({ where: { userId }, data: { whatsappCodeAttempts: { increment: 1 } } });
      return next(createError('That code is not correct.', 400));
    }
    await prisma.notificationPreference.update({
      where: { userId },
      data: { whatsappVerifiedAt: new Date(), whatsappCodeHash: null, whatsappCodeExpiresAt: null, whatsappCodeAttempts: 0 },
    });
    res.json({ verified: true, number: maskNumber(prefs.whatsappNumber) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/push/whatsapp — stop WhatsApp alerts and forget the number
router.delete('/whatsapp', writeLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.notificationPreference.updateMany({
      where: { userId: req.user!.userId },
      data: { whatsappNumber: null, whatsappVerifiedAt: null, whatsappCodeHash: null, whatsappCodeExpiresAt: null, whatsappCodeAttempts: 0 },
    });
    res.json({ verified: false });
  } catch (err) {
    next(err);
  }
});

export default router;
