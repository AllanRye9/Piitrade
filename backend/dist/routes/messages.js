"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// A user counts as "online" (green dot) if their presence was last
// touched within this window — see the throttled touch in
// middleware/auth.ts. 2 minutes comfortably covers the up-to-60s touch
// throttle plus normal request gaps while someone's actively using the
// site, without a stale dot lingering long after they've actually left.
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
function isOnline(lastActiveAt) {
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
const typingUntil = new Map();
const TYPING_TTL_MS = 5000;
router.post('/typing', async (req, res, next) => {
    try {
        const { receiverId } = req.body;
        if (!receiverId)
            return next((0, errorHandler_1.createError)('receiverId is required', 400));
        typingUntil.set(`${req.user.userId}:${receiverId}`, Date.now() + TYPING_TTL_MS);
        res.status(204).end();
    }
    catch (err) {
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
router.get('/thread/:userId/status', async (req, res, next) => {
    try {
        const counterpart = await prisma_1.prisma.user.findUnique({
            where: { id: req.params.userId },
            select: { id: true, name: true, avatar: true, lastActiveAt: true },
        });
        if (!counterpart)
            return next((0, errorHandler_1.createError)('User not found', 404));
        const typingExpiry = typingUntil.get(`${req.params.userId}:${req.user.userId}`);
        const typing = !!typingExpiry && typingExpiry > Date.now();
        res.json({
            counterpart: { id: counterpart.id, name: counterpart.name, avatar: counterpart.avatar },
            online: isOnline(counterpart.lastActiveAt),
            lastActiveAt: counterpart.lastActiveAt,
            typing,
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/messages/unread-count — lightweight total across all
// conversations, for the header chat badge. Polled periodically by the
// frontend, so kept minimal (a single count() rather than the full
// conversations list /conversations returns).
router.get('/unread-count', async (req, res, next) => {
    try {
        const count = await prisma_1.prisma.message.count({
            where: { receiverId: req.user.userId, read: false },
        });
        res.json({ count });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/messages/conversations — one row per counterpart the current
// user has exchanged messages with, most-recent-first. Powers the Web
// Store "Customer communication" tool as well as the general inbox.
router.get('/conversations', async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const messages = await prisma_1.prisma.message.findMany({
            where: { OR: [{ senderId: userId }, { receiverId: userId }] },
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { id: true, name: true, avatar: true, lastActiveAt: true } },
                receiver: { select: { id: true, name: true, avatar: true, lastActiveAt: true } },
                listing: { select: { id: true, title: true, images: true } },
            },
            take: 500, // bounded scan; fine for a per-user inbox
        });
        const conversations = new Map();
        for (const m of messages) {
            const counterpart = m.senderId === userId ? m.receiver : m.sender;
            const key = counterpart.id;
            if (!conversations.has(key)) {
                conversations.set(key, {
                    counterpart: {
                        id: counterpart.id, name: counterpart.name, avatar: counterpart.avatar,
                        online: isOnline(counterpart.lastActiveAt), lastActiveAt: counterpart.lastActiveAt,
                    },
                    lastMessage: m.content,
                    lastMessageAt: m.createdAt.toISOString(),
                    listing: m.listing ? { id: m.listing.id, title: m.listing.title, images: m.listing.images } : null,
                    unreadCount: 0,
                });
            }
            if (m.receiverId === userId && !m.read) {
                conversations.get(key).unreadCount += 1;
            }
        }
        res.json({ conversations: Array.from(conversations.values()) });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/messages/thread/:userId — full message thread with one counterpart
router.get('/thread/:userId', async (req, res, next) => {
    try {
        const me = req.user.userId;
        const other = req.params.userId;
        const thread = await prisma_1.prisma.message.findMany({
            where: {
                OR: [
                    { senderId: me, receiverId: other },
                    { senderId: other, receiverId: me },
                ],
            },
            orderBy: { createdAt: 'asc' },
            include: { listing: { select: { id: true, title: true, images: true } } },
        });
        // Mark incoming messages in this thread as read
        await prisma_1.prisma.message.updateMany({
            where: { senderId: other, receiverId: me, read: false },
            data: { read: true },
        });
        res.json({ messages: thread });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/messages — send a message (buyer <-> seller/store owner)
router.post('/', async (req, res, next) => {
    try {
        const { receiverId, content, listingId } = req.body;
        if (!receiverId)
            return next((0, errorHandler_1.createError)('receiverId is required', 400));
        if (!content || !content.trim())
            return next((0, errorHandler_1.createError)('Message content is required', 400));
        if (receiverId === req.user.userId)
            return next((0, errorHandler_1.createError)('Cannot message yourself', 400));
        const receiver = await prisma_1.prisma.user.findUnique({ where: { id: receiverId }, select: { id: true } });
        if (!receiver)
            return next((0, errorHandler_1.createError)('Recipient not found', 404));
        const message = await prisma_1.prisma.message.create({
            data: {
                senderId: req.user.userId,
                receiverId,
                content: content.trim(),
                listingId: listingId || null,
            },
            include: { listing: { select: { id: true, title: true, images: true } } },
        });
        // Clear any in-flight typing indicator now that the message it was
        // building up to has actually arrived — otherwise the bouncing-dots
        // bubble could briefly linger for up to TYPING_TTL_MS after the real
        // message already appeared.
        typingUntil.delete(`${req.user.userId}:${receiverId}`);
        await prisma_1.prisma.notification.create({
            data: {
                userId: receiverId,
                type: 'MESSAGE_RECEIVED',
                title: 'New message',
                message: content.trim().slice(0, 140),
                data: { senderId: req.user.userId, listingId: listingId || null },
            },
        }).catch(() => { });
        res.status(201).json({ message });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/messages/:id/read — mark a single message read
router.put('/:id/read', async (req, res, next) => {
    try {
        const message = await prisma_1.prisma.message.findUnique({ where: { id: req.params.id } });
        if (!message)
            return next((0, errorHandler_1.createError)('Message not found', 404));
        if (message.receiverId !== req.user.userId)
            return next((0, errorHandler_1.createError)('Forbidden', 403));
        const updated = await prisma_1.prisma.message.update({ where: { id: req.params.id }, data: { read: true } });
        res.json({ message: updated });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=messages.js.map