import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import {
  MAX_SAVED_SEARCHES_PER_USER, sanitizeParams, hasAnyFilter, describeParams, buildSavedSearchWhere,
} from '../utils/savedSearches';

/**
 * Saved searches ARE the user's alerts: with `notify` on, a matching new listing triggers an instant
 * profile notification, a sound (if `notifySound`) and an e-mail (if `notifyEmail`) — see
 * utils/listingAlerts.ts. `notify` is the master switch (stored as `emailAlert`, a historical name).
 */
const router = Router();
router.use(authenticate);

const publicShape = (s: {
  id: string; name: string; emailAlert: boolean; notifyEmail: boolean; notifySound: boolean; createdAt: Date;
  lastCheckedAt: Date; lastAlertAt: Date | null; filters: unknown;
}, newCount: number) => {
  const params = sanitizeParams(s.filters);
  return {
    id: s.id, name: s.name || describeParams(params), params, notify: s.emailAlert,
    notifyEmail: s.notifyEmail, notifySound: s.notifySound, createdAt: s.createdAt,
    lastCheckedAt: s.lastCheckedAt, lastAlertAt: s.lastAlertAt, newCount,
  };
};

// GET /api/saved-searches — the caller's alerts, each with how many matching listings are new since it was last opened
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.savedSearch.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_SAVED_SEARCHES_PER_USER,
    });
    const now = new Date();
    const searches = await Promise.all(rows.map(async (s) => {
      const params = sanitizeParams(s.filters);
      const newCount = hasAnyFilter(params)
        ? await prisma.listing.count({ where: buildSavedSearchWhere(params, now, s.lastCheckedAt) })
        : 0;
      return publicShape(s, newCount);
    }));
    res.json({ searches, max: MAX_SAVED_SEARCHES_PER_USER });
  } catch (err) { next(err); }
});

// POST /api/saved-searches { params, name?, notify?, notifyEmail?, notifySound? }
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const params = sanitizeParams(req.body?.params);
    if (!hasAnyFilter(params)) return next(createError('Add a keyword or a filter before saving an alert', 400));
    const userId = req.user!.userId;
    const existing = await prisma.savedSearch.findMany({ where: { userId }, select: { id: true, filters: true } });
    const key = JSON.stringify(Object.entries(params).sort());
    const dup = existing.find((e) => JSON.stringify(Object.entries(sanitizeParams(e.filters)).sort()) === key);
    if (dup) return res.status(200).json({ id: dup.id, duplicate: true });
    if (existing.length >= MAX_SAVED_SEARCHES_PER_USER) {
      return next(createError(`You can have up to ${MAX_SAVED_SEARCHES_PER_USER} alerts. Delete one first.`, 400));
    }
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    const created = await prisma.savedSearch.create({
      data: {
        userId,
        filters: { ...params },
        categorySlug: params.category ?? null,
        name: rawName || describeParams(params),
        emailAlert: req.body?.notify === false ? false : true,
        notifyEmail: req.body?.notifyEmail === false ? false : true,
        notifySound: req.body?.notifySound === false ? false : true,
      },
    });
    res.status(201).json({ id: created.id, name: created.name });
  } catch (err) { next(err); }
});

// PATCH /api/saved-searches/:id { name?, params?, notify?, notifyEmail?, notifySound?, seen? }
// `seen` moves the "new" watermark to now; `params` replaces the criteria.
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const s = await prisma.savedSearch.findUnique({ where: { id: req.params.id } });
    if (!s || s.userId !== req.user!.userId) return next(createError('Alert not found', 404));
    const data: {
      name?: string; emailAlert?: boolean; notifyEmail?: boolean; notifySound?: boolean;
      lastCheckedAt?: Date; filters?: object; categorySlug?: string | null;
    } = {};
    if (typeof req.body?.name === 'string' && req.body.name.trim()) data.name = req.body.name.trim().slice(0, 80);
    if (typeof req.body?.notify === 'boolean') data.emailAlert = req.body.notify;
    if (typeof req.body?.notifyEmail === 'boolean') data.notifyEmail = req.body.notifyEmail;
    if (typeof req.body?.notifySound === 'boolean') data.notifySound = req.body.notifySound;
    if (req.body?.seen === true) data.lastCheckedAt = new Date();
    if (req.body?.params !== undefined) {
      const params = sanitizeParams(req.body.params);
      if (!hasAnyFilter(params)) return next(createError('An alert needs a keyword or a filter', 400));
      data.filters = { ...params };
      data.categorySlug = params.category ?? null;
      data.lastCheckedAt = new Date(); // new criteria: "new since" starts from now
      // Keep an auto-generated name in step with the criteria; a name the user chose stays.
      if (data.name === undefined && s.name === describeParams(sanitizeParams(s.filters))) data.name = describeParams(params);
    }
    const updated = await prisma.savedSearch.update({ where: { id: s.id }, data });
    res.json({ id: updated.id, name: updated.name, notify: updated.emailAlert, notifyEmail: updated.notifyEmail, notifySound: updated.notifySound });
  } catch (err) { next(err); }
});

// DELETE /api/saved-searches/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await prisma.savedSearch.deleteMany({ where: { id: req.params.id, userId: req.user!.userId } });
    if (!result.count) return next(createError('Alert not found', 404));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
