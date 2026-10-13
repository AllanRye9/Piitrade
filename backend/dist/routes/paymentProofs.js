"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../utils/logger");
const paymentProofService_1 = require("../utils/paymentProofService");
const paymentProof_1 = require("../utils/paymentProof");
// Manual MTN mobile-money payments (no API): the buyer submits the MTN
// transaction ID, an ADMIN compares it with the MTN statement and confirms or
// rejects it. Business rules live in utils/paymentProofService.ts.
const router = (0, express_1.Router)();
const db = prisma_1.prisma;
async function paymentDeadlineMinutes() {
    const config = await prisma_1.prisma.siteConfig.findUnique({ where: { id: 'global' }, select: { paymentSettings: true } });
    const settings = (config?.paymentSettings ?? {});
    return (0, paymentProof_1.resolveDeadlineMinutes)(settings.paymentDeadlineMinutes);
}
// POST /api/payment-proofs — buyer: "I paid, here is the transaction ID"
router.post('/', auth_1.authenticate, async (req, res, next) => {
    try {
        const { orderId, transactionId, senderPhone, amount } = req.body ?? {};
        if (!orderId || typeof orderId !== 'string') {
            res.status(400).json({ message: 'orderId is required' });
            return;
        }
        const proof = await (0, paymentProofService_1.submitPaymentProof)(db, {
            orderId,
            userId: req.user.userId,
            input: { transactionId, senderPhone, amount },
        });
        // Tell the admins there is something to review. Best effort: a notification
        // failure must never lose or fail the buyer's submission.
        try {
            const [admins, order] = await Promise.all([
                prisma_1.prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } }),
                prisma_1.prisma.order.findUnique({ where: { id: orderId }, select: { orderNumber: true } }),
            ]);
            if (admins.length > 0) {
                await prisma_1.prisma.notification.createMany({
                    data: admins.map((a) => ({
                        userId: a.id,
                        type: 'PAYMENT_RECEIVED',
                        title: 'Payment proof to review',
                        message: `A buyer submitted MTN transaction ${proof.transactionId} for order ${order?.orderNumber ?? orderId}. Check it against the MTN statement.`,
                        data: { orderId, proofId: proof.id },
                    })),
                });
            }
        }
        catch (err) {
            logger_1.logger.error('Failed to notify admins of a payment proof', err);
        }
        res.status(201).json({ proof });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/payment-proofs/admin/counts — numbers for the dashboard banner and sidebar badge
router.get('/admin/counts', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (_req, res, next) => {
    try {
        const [awaitingReview, lateAwaiting] = await Promise.all([
            prisma_1.prisma.paymentProof.count({ where: { status: 'SUBMITTED' } }),
            // proofs on orders the expiry sweep already cancelled: confirming one reinstates the order
            prisma_1.prisma.paymentProof.count({ where: { status: 'SUBMITTED', order: { status: 'CANCELLED' } } }),
        ]);
        res.json({ awaitingReview, lateAwaiting });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/payment-proofs/admin?status=SUBMITTED|CONFIRMED|REJECTED|ALL
router.get('/admin', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'SUBMITTED';
        const where = ['SUBMITTED', 'CONFIRMED', 'REJECTED'].includes(status) ? { status } : {};
        const proofs = await prisma_1.prisma.paymentProof.findMany({
            where,
            // Oldest first for the review queue, newest first for history.
            orderBy: { createdAt: status === 'SUBMITTED' ? 'asc' : 'desc' },
            take: 200,
            include: {
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        total: true,
                        currency: true,
                        status: true,
                        createdAt: true,
                        buyer: { select: { id: true, name: true, email: true, phone: true } },
                    },
                },
                payment: { select: { amount: true, status: true, dueAt: true } },
            },
        });
        res.json({ proofs });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/payment-proofs/:id/confirm — admin saw the money on the statement
router.post('/:id/confirm', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const result = await (0, paymentProofService_1.confirmPaymentProof)(db, {
            proofId: req.params.id,
            adminId: req.user.userId,
            amountReceived: req.body?.amountReceived,
            note: typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : undefined,
        });
        logger_1.logger.info(`Payment confirmed for order ${result.orderNumber} by admin ${req.user.userId}`);
        res.json({ confirmed: true, ...result });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/payment-proofs/:id/reject — no matching payment found
router.post('/:id/reject', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const result = await (0, paymentProofService_1.rejectPaymentProof)(db, {
            proofId: req.params.id,
            adminId: req.user.userId,
            reason: req.body?.reason,
            deadlineMinutes: await paymentDeadlineMinutes(),
        });
        res.json({ rejected: true, ...result });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=paymentProofs.js.map