import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { rateLimit } from 'express-rate-limit';
import { getConversations, getUnreadTotal, decodeCursor, clampLimit } from '../utils/inbox';
import { createError } from '../middleware/errorHandler';

const router = Router();

router.use(authenticate);

// Per-account send limit. Messaging is the product's main contact channel, so an
// unthrottled sender could flood any user's inbox and notification feed. Keyed by
// user id (not IP) so shared mobile-carrier IPs don't penalise each other.
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.userId ?? req.ip ?? 'anon',
  message: { message: 'You are sending messages too quickly. Please wait a minute.' },
});
const MAX_MESSAGE_LENGTH = 2000;

// A user counts as "online" (green dot) if their presence was last
// touched within this window — see the throttled touch in
// middleware/auth.ts. 2 minutes comfortably covers the up-to-60s touch
// throttle plus normal request gaps while someone's actively using the
// site, without a stale dot lingering long after they've actually left.
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
function isOnline(lastActiveAt: Date | null): boolean {
  return !!lastActiveAt && Date.now() - lastActiveAt.getTime() < ONLINE_WINDOW_MS;
}

// ─── Typing indicator ───────────────────────────────────────────────────────
// In-memory, per-process, like the presence throttle in middleware/auth.ts.
// A typing indicator is inherently ephemeral and low-stakes — worst case on
// a multi-instance deployment is an occasional missed or slightly-stale
// bouncing-dots bubble, never a lost message — so this doesn't warrant a
// shared store. Keyed "senderId:receiverId"; each entry expires on its own
// via the timestamp check in GET /thread/:userId/status, no cleanup timer
// needed.
const typingUntil = new Map<string, number>();
const TYPING_TTL_MS = 5000;

router.post('/typing', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { receiverId } = req.body as { receiverId?: string };
    if (!receiverId) return next(createError('receiverId is required', 400));
    typingUntil.set(`${req.user!.userId}:${receiverId}`, Date.now() + TYPING_TTL_MS);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/thread/:userId/status — lightweight, fast-pollable
// companion to GET /thread/:userId: just the counterpart's presence and
// whether they're currently typing to me. Deliberately separate from the
// full thread fetch (and its heavier read-receipt side effect) so the
// frontend can poll this every ~2-3s for a snappy typing/online feel
// without re-fetching and re-marking-read the whole message history that
// often.
router.get('/thread/:userId/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const counterpart = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, name: true, avatar: true, lastActiveAt: true },
    });
    if (!counterpart) return next(createError('User not found', 404));

    const typingExpiry = typingUntil.get(`${req.params.userId}:${req.user!.userId}`);
    const typing = !!typingExpiry && typingExpiry > Date.now();

    res.json({
      counterpart: { id: counterpart.id, name: counterpart.name, avatar: counterpart.avatar },
      online: isOnline(counterpart.lastActiveAt),
      lastActiveAt: counterpart.lastActiveAt,
      typing,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/unread-count — lightweight total across all
// conversations, for the header chat badge. Polled periodically by the
// frontend, so kept minimal (a single count() rather than the full
// conversations list /conversations returns).
router.get('/unread-count', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const count = await prisma.message.count({
      where: { receiverId: req.user!.userId, read: false },
    });
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/conversations[?limit=30&cursor=<opaque>&unreadOnly=true]
// One row per (counterpart, listing) pair, newest activity first. Keyset-paginated: pass back the
// `nextCursor` of the previous page to get the next one. The response keeps its old `conversations`
// array (same fields) and adds `nextCursor`, `hasMore`, `unreadTotal` and, per row, `lastMessageId`
// and `lastMessageFromMe`. See utils/inbox.ts for why this is a single SQL query now.
router.get('/conversations', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const cursorRaw = req.query.cursor;
    const cursor = cursorRaw === undefined ? null : decodeCursor(cursorRaw);
    if (cursorRaw !== undefined && !cursor) return next(createError('Invalid cursor', 400));

    const [page, unreadTotal] = await Promise.all([
      getConversations(userId, {
        limit: clampLimit(req.query.limit),
        cursor,
        unreadOnly: req.query.unreadOnly === 'true',
      }),
      getUnreadTotal(userId),
    ]);
    res.set('Cache-Control', 'private, no-store');
    res.json({ ...page, unreadTotal });
  } catch (err) {
    next(err);
  }
});

// GET /api/messages/thread/:userId[?listing=<id|none>&limit=50&before=<messageId>]
// The newest `limit` messages with this person (oldest-first within the page, as before), plus
// `hasMore` and `nextBefore` — pass `before=<nextBefore>` to load the page of older messages.
// Without `limit` the newest 100 are returned (it used to return the entire history).
router.get('/thread/:userId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!.userId;
    const other = req.params.userId;
    const limit = clampLimit(req.query.limit, 100, 200);

    // ?listing=<id> scopes the thread to ONE item with this person;
    // ?listing=none to their general (no-item) messages; omitted = everything
    // exchanged with them (kept for older links).
    const listingParam = typeof req.query.listing === 'string' ? req.query.listing : undefined;
    const listingScope: Prisma.MessageWhereInput =
      listingParam === undefined ? {} : listingParam === 'none' ? { listingId: null } : { listingId: listingParam };

    const pair: Prisma.MessageWhereInput = {
      OR: [
        { senderId: me, receiverId: other },
        { senderId: other, receiverId: me },
      ],
    };

    let olderThan: Prisma.MessageWhereInput = {};
    if (typeof req.query.before === 'string' && req.query.before) {
      const anchor = await prisma.message.findFirst({
        where: { id: req.query.before, AND: [pair] },   // must belong to THIS conversation
        select: { id: true, createdAt: true },
      });
      if (!anchor) return next(createError('Invalid "before" message', 400));
      olderThan = { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] };
    }

    const newestFirst = await prisma.message.findMany({
      where: { AND: [pair, listingScope, olderThan] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { listing: { select: { id: true, title: true, images: true } } },
    });
    const hasMore = newestFirst.length > limit;
    const pageDesc = hasMore ? newestFirst.slice(0, limit) : newestFirst;
    const thread = pageDesc.slice().reverse();

    // Mark incoming messages in this thread (and only this thread) as read
    await prisma.message.updateMany({
      where: { senderId: other, receiverId: me, read: false, ...listingScope },
      data: { read: true },
    });

    res.set('Cache-Control', 'private, no-store');
    res.json({ messages: thread, hasMore, nextBefore: hasMore ? thread[0]?.id ?? null : null });
  } catch (err) {
    next(err);
  }
});

// POST /api/messages — send a message (buyer <-> seller/store owner)
router.post('/', sendLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { receiverId, content, listingId } = (req.body ?? {}) as {
      receiverId?: unknown; content?: unknown; listingId?: string;
    };
    if (typeof receiverId !== 'string' || !receiverId) return next(createError('receiverId is required', 400));
    if (typeof content !== 'string' || !content.trim()) return next(createError('Message content is required', 400));
    if (content.length > MAX_MESSAGE_LENGTH) return next(createError(`Messages can be at most ${MAX_MESSAGE_LENGTH} characters`, 400));
    if (listingId != null && typeof listingId !== 'string') return next(createError('Invalid listingId', 400));
    if (receiverId === req.user!.userId) return next(createError('Cannot message yourself', 400));

    const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { id: true } });
    if (!receiver) return next(createError('Recipient not found', 404));
    if (listingId && !(await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true } }))) {
      return next(createError('Listing not found', 404));
    }

    const message = await prisma.message.create({
      data: {
        senderId:   req.user!.userId,
        receiverId,
        content:    content.trim(),
        listingId:  listingId || null,
      },
      include: { listing: { select: { id: true, title: true, images: true } } },
    });

    // Clear any in-flight typing indicator now that the message it was
    // building up to has actually arrived — otherwise the bouncing-dots
    // bubble could briefly linger for up to TYPING_TTL_MS after the real
    // message already appeared.
    typingUntil.delete(`${req.user!.userId}:${receiverId}`);

    await prisma.notification.create({
      data: {
        userId:  receiverId,
        type:    'MESSAGE_RECEIVED',
        title:   'New message',
        message: content.trim().slice(0, 140),
        data:    { senderId: req.user!.userId, listingId: listingId || null } as Prisma.InputJsonValue,
      },
    }).catch(() => { /* notification is best-effort */ });

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

// PUT /api/messages/:id/read — mark a single message read
router.put('/:id/read', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const message = await prisma.message.findUnique({ where: { id: req.params.id } });
    if (!message) return next(createError('Message not found', 404));
    if (message.receiverId !== req.user!.userId) return next(createError('Forbidden', 403));

    const updated = await prisma.message.update({ where: { id: req.params.id }, data: { read: true } });
    res.json({ message: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
