"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const llm_1 = require("../lib/llm");
const router = (0, express_1.Router)();
// The exact fallback the moderation spec defines for "answer not in
// context" — reused verbatim here for every other reason there's no
// answer (LLM not configured, call failed, empty FAQ context) so a shopper
// never sees a different message depending on *why* the bot couldn't help,
// only that it couldn't.
const HUMAN_TRANSFER_FALLBACK = "I'm sorry, I cannot find that information. Let me transfer you to a human agent.";
const MAX_MESSAGE_LENGTH = 1000;
function buildSystemPrompt(faqContext) {
    return `You are the official Customer Support AI for our e-commerce platform. Your goal is to resolve user inquiries politely, accurately, and concisely (under 3 sentences).

Strict Guardrails:
1. Base your answer ONLY on the provided "Platform Policy Context" section below.
2. If the user's question cannot be answered using the provided context, reply exactly with: "${HUMAN_TRANSFER_FALLBACK}"
3. Do not make up facts, urls, phone numbers, or platform policies.

Platform Policy Context:
${faqContext}`;
}
/**
 * POST /support/chat — { message: string }
 * optionalAuthenticate (not authenticate): the support widget is available
 * to logged-out visitors too, since "how do I sign up" / "is this site
 * legit" are exactly the questions a not-yet-registered visitor would ask.
 * req.user, when present, only decides the "User Account Status" line
 * handed to the LLM (see the spec's user-prompt template) — it never
 * changes which FAQ context the answer is grounded in.
 */
router.post('/chat', auth_1.optionalAuthenticate, async (req, res, next) => {
    try {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
            return next((0, errorHandler_1.createError)('message is required', 400));
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            return next((0, errorHandler_1.createError)(`message must be ${MAX_MESSAGE_LENGTH} characters or fewer`, 400));
        }
        const config = await prisma_1.prisma.siteConfig.findUnique({ where: { id: 'global' } });
        const faqContext = config?.supportFaqContext?.trim();
        // Nothing to ground an answer in — always transfer, without spending an
        // LLM call to be told the same thing (also covers "LLM not configured"
        // implicitly, since callLLMText would return null anyway in that case).
        if (!faqContext) {
            res.json({ reply: HUMAN_TRANSFER_FALLBACK, handoff: true });
            return;
        }
        const accountStatus = req.user
            ? `logged in (${req.user.role.toLowerCase()})`
            : 'guest (not logged in)';
        const userPrompt = `User Account Status: ${accountStatus}\nUser Query: ${message.trim()}`;
        const reply = await (0, llm_1.callLLMText)(buildSystemPrompt(faqContext), userPrompt);
        const finalReply = reply?.trim() || HUMAN_TRANSFER_FALLBACK;
        // `handoff` tells the widget to offer the "Connect me to a human" button —
        // true whenever the bot gave up (the exact fallback sentence, or no answer).
        res.json({ reply: finalReply, handoff: finalReply.includes('transfer you to a human agent') });
    }
    catch (err) {
        next(err);
    }
});
// ─── Human handoff ───────────────────────────────────────────────────────────
const MAX_TRANSCRIPT_TURNS = 20;
const MAX_CONTACT_LENGTH = 200;
function cleanStr(v, max) {
    if (typeof v !== 'string')
        return null;
    const t = v.trim().slice(0, max);
    return t || null;
}
/**
 * POST /support/handoff — { question, transcript?, contactName?, contactEmail?, contactPhone? }
 * Called when the bot could not answer and the shopper asks for a person.
 * Logged-in users are identified by their account; guests must leave an email
 * or phone so an admin can reach them. Creates an OPEN SupportRequest and
 * notifies every admin. Repeat clicks within 10 minutes reuse the same request
 * instead of spamming the queue.
 */
router.post('/handoff', auth_1.optionalAuthenticate, async (req, res, next) => {
    try {
        const body = req.body;
        const question = cleanStr(body.question, MAX_MESSAGE_LENGTH);
        if (!question)
            return next((0, errorHandler_1.createError)('question is required', 400));
        const userId = req.user?.userId ?? null;
        const contactName = cleanStr(body.contactName, MAX_CONTACT_LENGTH);
        const contactEmail = cleanStr(body.contactEmail, MAX_CONTACT_LENGTH);
        const contactPhone = cleanStr(body.contactPhone, MAX_CONTACT_LENGTH);
        if (!userId && !contactEmail && !contactPhone) {
            return next((0, errorHandler_1.createError)('Please leave an email address or phone number so our team can reach you.', 400));
        }
        if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
            return next((0, errorHandler_1.createError)('That email address does not look valid.', 400));
        }
        const transcript = Array.isArray(body.transcript)
            ? body.transcript.slice(-MAX_TRANSCRIPT_TURNS).map((t) => {
                const turn = t;
                return {
                    role: turn.role === 'assistant' ? 'assistant' : 'user',
                    text: cleanStr(turn.text, MAX_MESSAGE_LENGTH) ?? '',
                };
            })
            : [];
        // De-duplicate: same account / same contact, still OPEN, last 10 minutes.
        const since = new Date(Date.now() - 10 * 60 * 1000);
        const existing = await prisma_1.prisma.supportRequest.findFirst({
            where: {
                status: 'OPEN',
                createdAt: { gte: since },
                ...(userId ? { userId } : { OR: [...(contactEmail ? [{ contactEmail }] : []), ...(contactPhone ? [{ contactPhone }] : [])] }),
            },
            select: { id: true },
        });
        if (existing) {
            res.json({ ok: true, id: existing.id, duplicate: true });
            return;
        }
        const created = await prisma_1.prisma.supportRequest.create({
            data: { userId, contactName, contactEmail, contactPhone, question, transcript },
        });
        const admins = await prisma_1.prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
        if (admins.length > 0) {
            await prisma_1.prisma.notification.createMany({
                data: admins.map((a) => ({
                    userId: a.id,
                    type: 'SYSTEM',
                    title: 'Support chat needs a human',
                    message: `A shopper asked to talk to a person: "${question.slice(0, 140)}"`,
                    data: { supportRequestId: created.id },
                })),
            }).catch(() => { });
        }
        res.status(201).json({ ok: true, id: created.id });
    }
    catch (err) {
        next(err);
    }
});
// GET /support/admin/requests?status=OPEN|RESOLVED — admin queue (OPEN first, newest first)
router.get('/admin/requests', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const status = req.query.status === 'RESOLVED' ? 'RESOLVED' : req.query.status === 'OPEN' ? 'OPEN' : undefined;
        const requests = await prisma_1.prisma.supportRequest.findMany({
            where: status ? { status } : {},
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            take: 200,
        });
        const userIds = [...new Set(requests.map((r) => r.userId).filter((v) => Boolean(v)))];
        const users = userIds.length
            ? await prisma_1.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, role: true } })
            : [];
        const byId = new Map(users.map((u) => [u.id, u]));
        const openCount = await prisma_1.prisma.supportRequest.count({ where: { status: 'OPEN' } });
        res.json({ openCount, requests: requests.map((r) => ({ ...r, user: r.userId ? byId.get(r.userId) ?? null : null })) });
    }
    catch (err) {
        next(err);
    }
});
// PATCH /support/admin/requests/:id — { status?: 'OPEN'|'RESOLVED', response?: string }
// A response is delivered to the user's notification inbox when they have an account.
router.patch('/admin/requests/:id', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const existing = await prisma_1.prisma.supportRequest.findUnique({ where: { id: req.params.id } });
        if (!existing)
            return next((0, errorHandler_1.createError)('Support request not found', 404));
        const { status: rawStatus, response } = req.body;
        if (rawStatus !== undefined && rawStatus !== 'OPEN' && rawStatus !== 'RESOLVED') {
            return next((0, errorHandler_1.createError)("status must be 'OPEN' or 'RESOLVED'", 400));
        }
        // Narrow explicitly: the compound check above does not narrow `string` to
        // the enum's literal union for Prisma's typed `status` field.
        const status = rawStatus === 'OPEN' || rawStatus === 'RESOLVED' ? rawStatus : undefined;
        const adminResponse = response !== undefined ? cleanStr(response, 2000) : undefined;
        const updated = await prisma_1.prisma.supportRequest.update({
            where: { id: existing.id },
            data: {
                ...(adminResponse !== undefined && { adminResponse }),
                ...(status && {
                    status,
                    resolvedBy: status === 'RESOLVED' ? req.user.userId : null,
                    resolvedAt: status === 'RESOLVED' ? new Date() : null,
                }),
            },
        });
        if (adminResponse && existing.userId) {
            await prisma_1.prisma.notification.create({
                data: {
                    userId: existing.userId,
                    type: 'SYSTEM',
                    title: 'Reply from Piitrade support',
                    message: adminResponse,
                    data: { supportRequestId: existing.id },
                },
            }).catch(() => { });
        }
        res.json({ request: updated });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=support.js.map