import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { recordAdminAudit } from '../utils/adminAudit';
import { sendAdminWipeCodeEmail } from '../utils/email';
import { logger } from '../utils/logger';
import {
  WIPE_CODE_TTL_MS,
  WIPE_MAX_ATTEMPTS,
  WIPE_RESEND_COOLDOWN_MS,
  WIPE_SCOPE_LABELS,
  generateWipeCode,
  hashWipeCode,
  isWipeScope,
  maskEmail,
  verifyWipeCode,
} from '../utils/adminWipe';

/**
 * Admin log tooling, mounted at /api/admin/logs:
 *
 *   GET  /visitors/grouped  /visitors/group   Visitor Logs, one row per IP (with the per-day rows on expand)
 *   GET  /searches/grouped  /searches/group   Search Logs, one row per search term
 *   GET  /clicks/grouped    /clicks/group     Item Clicks, one row per listing
 *   POST /wipe/request                        emails a one-time code to the signed-in admin
 *   POST /wipe/confirm                        wipes the chosen logs, only with that code
 *
 * The flat per-row lists stay where they were (/api/admin/visitor-logs, /search-logs, /click-logs).
 */
const router = Router();
router.use(authenticate, authorize('ADMIN'));
// Admin data must always be live: never let a browser, proxy or CDN serve a stale copy.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});

const DETAIL_ROW_LIMIT = 200;

// ─── helpers ────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function paging(q: Record<string, unknown>) {
  const page = Math.max(1, parseInt(str(q.page) || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(str(q.limit) || '25', 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

/** Escapes LIKE wildcards so a search for "100%" matches literally. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function parseDay(value: string, endOfDay: boolean): Date | null {
  if (!value) return null;
  const d = new Date(endOfDay ? `${value}T23:59:59.999Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function where(conds: Prisma.Sql[]): Prisma.Sql {
  return conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
}

/** Picks an ORDER BY fragment from a fixed allowlist: user input never reaches the SQL text. */
function orderBy(map: Record<string, string>, requested: string, fallback: string, dir: unknown): Prisma.Sql {
  const column = map[requested] ?? map[fallback];
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  return Prisma.raw(`ORDER BY ${column} ${direction} NULLS LAST`);
}

const VISITOR_DEVICE_CATEGORIES = ['Mobile', 'Desktop', 'Tablet', 'Unknown device'];

// ─── Visitor Logs: grouped by IP ─────────────────────────────────────────────

function visitorConds(q: Record<string, unknown>, opts: { omitCountry?: boolean } = {}): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [];
  const date = str(q.date);
  const country = str(q.country).toUpperCase();
  const deviceCategory = str(q.deviceCategory);
  const search = str(q.search);
  if (date) conds.push(Prisma.sql`"dayKey" = ${date}`);
  if (country && !opts.omitCountry) conds.push(Prisma.sql`"country" = ${country}`);
  if (deviceCategory && VISITOR_DEVICE_CATEGORIES.includes(deviceCategory)) {
    conds.push(
      deviceCategory === 'Unknown device'
        ? Prisma.sql`"device" = 'Unknown device'`
        : Prisma.sql`"device" LIKE ${`${deviceCategory} ·%`}`,
    );
  }
  if (search) {
    const p = likePattern(search);
    conds.push(Prisma.sql`("ip" ILIKE ${p} OR "deviceId" ILIKE ${p} OR "country" ILIKE ${p} OR "device" ILIKE ${p})`);
  }
  return conds;
}

const VISITOR_SORT = {
  lastSeenAt: '"lastSeenAt"',
  firstSeenAt: '"firstSeenAt"',
  visits: '"visits"',
  days: '"days"',
  durationSeconds: '"durationSeconds"',
  country: '"country"',
  device: '"device"',
  ip: '"ip"',
};

router.get('/visitors/grouped', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit, offset } = paging(req.query);
    const conds = visitorConds(req.query);
    const order = orderBy(VISITOR_SORT, str(req.query.sortBy), 'lastSeenAt', req.query.sortDir);

    const [groups, totals, countryRows] = await Promise.all([
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT "ip",
               COUNT(*)::int AS "days",
               COUNT(DISTINCT "deviceId")::int AS "devices",
               COALESCE(SUM("visitCount"), 0)::int AS "visits",
               COALESCE(SUM("durationSeconds"), 0)::int AS "durationSeconds",
               MIN("firstSeenAt") AS "firstSeenAt",
               MAX("lastSeenAt") AS "lastSeenAt",
               (ARRAY_AGG("country" ORDER BY "lastSeenAt" DESC))[1] AS "country",
               (ARRAY_AGG("device" ORDER BY "lastSeenAt" DESC))[1] AS "device"
        FROM "VisitorLog" ${where(conds)}
        GROUP BY "ip" ${order}, "ip" ASC
        LIMIT ${limit} OFFSET ${offset}`,
      prisma.$queryRaw<Array<{ groups: number; rows: number; devices: number }>>`
        SELECT COUNT(DISTINCT "ip")::int AS "groups", COUNT(*)::int AS "rows", COUNT(DISTINCT "deviceId")::int AS "devices"
        FROM "VisitorLog" ${where(conds)}`,
      // Country list ignores the country filter itself so the dropdown always shows every option in scope.
      prisma.$queryRaw<Array<{ country: string | null; count: number }>>`
        SELECT "country", COUNT(*)::int AS "count"
        FROM "VisitorLog" ${where(visitorConds(req.query, { omitCountry: true }))}
        GROUP BY "country" ORDER BY "count" DESC`,
    ]);

    res.json({
      groups,
      pagination: { total: totals[0]?.groups ?? 0, page, limit },
      totalRows: totals[0]?.rows ?? 0,
      uniqueDeviceCount: totals[0]?.devices ?? 0,
      countryBreakdown: countryRows,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/visitors/group', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ip = str(req.query.ip);
    if (!ip) throw createError('ip is required', 400);
    const date = str(req.query.date);
    const country = str(req.query.country).toUpperCase();
    const rows = await prisma.visitorLog.findMany({
      where: { ip, ...(date ? { dayKey: date } : {}), ...(country ? { country } : {}) },
      orderBy: { lastSeenAt: 'desc' },
      take: DETAIL_ROW_LIMIT,
    });
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

// ─── Search Logs: grouped by search term ─────────────────────────────────────

function searchConds(q: Record<string, unknown>): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [];
  const search = str(q.search);
  const from = parseDay(str(q.dateFrom), false);
  const to = parseDay(str(q.dateTo), true);
  if (search) {
    const p = likePattern(search);
    conds.push(Prisma.sql`("query" ILIKE ${p} OR "userEmail" ILIKE ${p} OR "userPhone" ILIKE ${p} OR "ip" ILIKE ${p} OR "ipCountry" ILIKE ${p})`);
  }
  if (from) conds.push(Prisma.sql`"createdAt" >= ${from}`);
  if (to) conds.push(Prisma.sql`"createdAt" <= ${to}`);
  return conds;
}

const SEARCH_SORT = { lastAt: '"lastAt"', count: '"count"', term: '"key"' };

router.get('/searches/grouped', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit, offset } = paging(req.query);
    const conds = searchConds(req.query);
    const order = orderBy(SEARCH_SORT, str(req.query.sortBy), 'lastAt', req.query.sortDir);

    // Terms are merged case- and whitespace-insensitively ("iPhone " = "iphone"); filter-only searches (no term) share one group, key "".
    const [groups, totals] = await Promise.all([
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT LOWER(BTRIM(COALESCE("query", ''))) AS "key",
               COUNT(*)::int AS "count",
               COUNT(DISTINCT COALESCE("userEmail", "ip", 'guest'))::int AS "searchers",
               MIN("createdAt") AS "firstAt",
               MAX("createdAt") AS "lastAt",
               (ARRAY_AGG("query" ORDER BY "createdAt" DESC))[1] AS "term"
        FROM "SearchLog" ${where(conds)}
        GROUP BY 1 ${order}, "key" ASC
        LIMIT ${limit} OFFSET ${offset}`,
      prisma.$queryRaw<Array<{ groups: number; rows: number }>>`
        SELECT COUNT(DISTINCT LOWER(BTRIM(COALESCE("query", ''))))::int AS "groups", COUNT(*)::int AS "rows"
        FROM "SearchLog" ${where(conds)}`,
    ]);

    res.json({ groups, pagination: { total: totals[0]?.groups ?? 0, page, limit }, totalRows: totals[0]?.rows ?? 0 });
  } catch (err) {
    next(err);
  }
});

router.get('/searches/group', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key.trim().toLowerCase() : '';
    const from = parseDay(str(req.query.dateFrom), false);
    const to = parseDay(str(req.query.dateTo), true);
    const conds: Prisma.Sql[] = [Prisma.sql`LOWER(BTRIM(COALESCE("query", ''))) = ${key}`];
    if (from) conds.push(Prisma.sql`"createdAt" >= ${from}`);
    if (to) conds.push(Prisma.sql`"createdAt" <= ${to}`);
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id", "query", "context", "resultCount", "userEmail", "userPhone", "ip", "ipCountry",
             "latitude", "longitude", "locationAccuracy", "createdAt"
      FROM "SearchLog" ${where(conds)}
      ORDER BY "createdAt" DESC LIMIT ${DETAIL_ROW_LIMIT}`;
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

// ─── Item Clicks: grouped by listing ─────────────────────────────────────────

function clickConds(q: Record<string, unknown>): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [];
  const search = str(q.search);
  const from = parseDay(str(q.dateFrom), false);
  const to = parseDay(str(q.dateTo), true);
  if (search) {
    const p = likePattern(search);
    // Also match the listing's CURRENT title, so an edited item is found by its new name.
    conds.push(Prisma.sql`("listingTitle" ILIKE ${p} OR "userEmail" ILIKE ${p} OR "userPhone" ILIKE ${p} OR "ip" ILIKE ${p} OR "ipCountry" ILIKE ${p}
      OR "listingId" IN (SELECT "id" FROM "Listing" WHERE "title" ILIKE ${p}))`);
  }
  if (from) conds.push(Prisma.sql`"createdAt" >= ${from}`);
  if (to) conds.push(Prisma.sql`"createdAt" <= ${to}`);
  // Deleted listings have their id cleared. They are hidden unless the admin asks for them.
  const includeDeleted = str(q.includeDeleted) === 'true' || str(q.includeDeleted) === '1';
  if (!includeDeleted) conds.push(Prisma.sql`"listingId" IS NOT NULL`);
  return conds;
}

const CLICK_SORT = { lastAt: '"lastAt"', count: '"count"', title: '"title"' };

router.get('/clicks/grouped', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit, offset } = paging(req.query);
    const conds = clickConds(req.query);
    const order = orderBy(CLICK_SORT, str(req.query.sortBy), 'lastAt', req.query.sortDir);

    // A listing is one group by id; clicks on since-deleted listings (id cleared) group by their saved title.
    // Title, photo and status come from the LIVE listing (so edits, approvals and rejections show at once);
    // the click-time snapshot is only the fallback for deleted listings.
    const groups = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT COALESCE(c."listingId", 'title:' || c."listingTitle") AS "key",
             MAX(c."listingId") AS "listingId",
             COALESCE(MAX(l."title"), (ARRAY_AGG(c."listingTitle" ORDER BY c."createdAt" DESC))[1]) AS "title",
             COALESCE(
               MAX(pi."cdnUrl"),
               MAX(l."images"[1]),
               (ARRAY_AGG(c."listingImage" ORDER BY (c."listingImage" IS NULL), c."createdAt" DESC))[1]
             ) AS "image",
             MAX(l."status"::text) AS "status",
             COUNT(*)::int AS "count",
             COUNT(DISTINCT COALESCE(c."userEmail", c."ip", 'guest'))::int AS "visitors",
             MIN(c."createdAt") AS "firstAt",
             MAX(c."createdAt") AS "lastAt"
      FROM (SELECT * FROM "ListingClickLog" ${where(conds)}) c
      LEFT JOIN "Listing" l ON l."id" = c."listingId"
      LEFT JOIN LATERAL (
        SELECT p."cdnUrl" FROM "ProductImage" p
        WHERE p."listingId" = l."id" AND p."cdnUrl" IS NOT NULL AND p."status"::text <> 'REJECTED'
        ORDER BY p."uploadedAt" ASC LIMIT 1
      ) pi ON TRUE
      GROUP BY 1 ${order}, "key" ASC
      LIMIT ${limit} OFFSET ${offset}`;
    const totals = await prisma.$queryRaw<Array<{ groups: number; rows: number }>>`
      SELECT COUNT(DISTINCT COALESCE("listingId", 'title:' || "listingTitle"))::int AS "groups", COUNT(*)::int AS "rows"
      FROM "ListingClickLog" ${where(conds)}`;

    res.json({ groups, pagination: { total: totals[0]?.groups ?? 0, page, limit }, totalRows: totals[0]?.rows ?? 0 });
  } catch (err) {
    next(err);
  }
});

router.get('/clicks/group', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!key) throw createError('key is required', 400);
    const from = parseDay(str(req.query.dateFrom), false);
    const to = parseDay(str(req.query.dateTo), true);
    const conds: Prisma.Sql[] = [
      key.startsWith('title:')
        ? Prisma.sql`"listingId" IS NULL AND "listingTitle" = ${key.slice('title:'.length)}`
        : Prisma.sql`"listingId" = ${key}`,
    ];
    if (from) conds.push(Prisma.sql`"createdAt" >= ${from}`);
    if (to) conds.push(Prisma.sql`"createdAt" <= ${to}`);
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id", "listingTitle", "userEmail", "userPhone", "ip", "ipCountry",
             "latitude", "longitude", "locationAccuracy", "createdAt"
      FROM "ListingClickLog" ${where(conds)}
      ORDER BY "createdAt" DESC LIMIT ${DETAIL_ROW_LIMIT}`;
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

// ─── Wiping logs (needs an emailed one-time code) ────────────────────────────

router.post('/wipe/request', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const scope = req.body?.scope;
    if (!isWipeScope(scope)) throw createError('Choose which logs to clear.', 400);

    const adminId = req.user?.userId;
    const admin = adminId
      ? await prisma.user.findUnique({ where: { id: adminId }, select: { id: true, email: true, name: true, role: true } })
      : null;
    if (!admin || admin.role !== 'ADMIN' || !admin.email) throw createError('Admin account not found.', 403);

    const now = Date.now();
    const pending = await prisma.adminWipeChallenge.findFirst({
      where: { adminId: admin.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (pending && now - pending.createdAt.getTime() < WIPE_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((WIPE_RESEND_COOLDOWN_MS - (now - pending.createdAt.getTime())) / 1000);
      res.setHeader('Retry-After', String(wait));
      throw createError(`A code was just sent. You can request another in ${wait}s.`, 429);
    }

    // Housekeeping + only one live code per admin: a new request cancels the previous one.
    await prisma.adminWipeChallenge.deleteMany({ where: { createdAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } } });
    await prisma.adminWipeChallenge.updateMany({ where: { adminId: admin.id, usedAt: null }, data: { usedAt: new Date(now) } });

    const code = generateWipeCode();
    const challenge = await prisma.adminWipeChallenge.create({
      data: { adminId: admin.id, scope, codeHash: await hashWipeCode(code), expiresAt: new Date(now + WIPE_CODE_TTL_MS) },
    });

    try {
      await sendAdminWipeCodeEmail(admin.email, admin.name, code, WIPE_SCOPE_LABELS[scope], Math.round(WIPE_CODE_TTL_MS / 60000));
    } catch (err) {
      await prisma.adminWipeChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
      logger.error(`Wipe confirmation email failed for admin ${admin.id}: ${String(err)}`);
      throw createError('The confirmation email could not be sent, so nothing was changed. Check the email settings and try again.', 502);
    }

    res.json({
      challengeId: challenge.id,
      sentTo: maskEmail(admin.email),
      expiresAt: challenge.expiresAt.toISOString(),
      cooldownSeconds: Math.round(WIPE_RESEND_COOLDOWN_MS / 1000),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/wipe/confirm', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { challengeId, code, scope, confirmText } = (req.body ?? {}) as Record<string, unknown>;
    if (!isWipeScope(scope)) throw createError('Choose which logs to clear.', 400);
    if (typeof challengeId !== 'string' || typeof code !== 'string') throw createError('Enter the code from your email.', 400);
    if (confirmText !== 'DELETE') throw createError('Type DELETE to confirm.', 400);

    const adminId = req.user?.userId;
    if (!adminId) throw createError('Not signed in.', 401);

    const challenge = await prisma.adminWipeChallenge.findFirst({ where: { id: challengeId, adminId } });
    const invalid = 'This code is no longer valid. Request a new one.';
    if (!challenge || challenge.usedAt || challenge.scope !== scope) throw createError(invalid, 400);
    if (challenge.expiresAt.getTime() < Date.now()) throw createError('This code has expired. Request a new one.', 400);

    // Count the attempt BEFORE checking the code, atomically, so parallel guesses cannot exceed the limit.
    const counted = await prisma.adminWipeChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, attempts: { lt: WIPE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) throw createError('Too many wrong codes. Request a new one.', 429);

    if (!(await verifyWipeCode(code.trim(), challenge.codeHash))) {
      const left = Math.max(0, WIPE_MAX_ATTEMPTS - (challenge.attempts + 1));
      throw createError(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Request a new one.', 400);
    }

    // Single use: whoever flips usedAt first wins.
    const consumed = await prisma.adminWipeChallenge.updateMany({ where: { id: challenge.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count === 0) throw createError(invalid, 400);

    // Only the chosen tables are touched; all deletes commit together or not at all.
    const targets: Array<{ key: 'visitorLogs' | 'searchLogs' | 'clickLogs'; op: Prisma.PrismaPromise<Prisma.BatchPayload> }> = [];
    if (scope === 'VISITOR_LOGS' || scope === 'ALL') targets.push({ key: 'visitorLogs', op: prisma.visitorLog.deleteMany({}) });
    if (scope === 'SEARCH_LOGS' || scope === 'ALL') targets.push({ key: 'searchLogs', op: prisma.searchLog.deleteMany({}) });
    if (scope === 'CLICK_LOGS' || scope === 'ALL') targets.push({ key: 'clickLogs', op: prisma.listingClickLog.deleteMany({}) });
    const results = await prisma.$transaction(targets.map((t) => t.op));
    const deleted = { visitorLogs: 0, searchLogs: 0, clickLogs: 0 };
    targets.forEach((t, i) => { deleted[t.key] = results[i].count; });

    const actor = await prisma.user.findUnique({ where: { id: adminId }, select: { email: true } });
    await recordAdminAudit({ action: 'LOGS_WIPED', actorId: adminId, actorEmail: actor?.email ?? null, meta: { scope, deleted } });

    res.json({ ok: true, scope, deleted });
  } catch (err) {
    next(err);
  }
});

export default router;
