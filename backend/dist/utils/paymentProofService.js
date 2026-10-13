"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentError = void 0;
exports.submitPaymentProof = submitPaymentProof;
exports.confirmPaymentProof = confirmPaymentProof;
exports.rejectPaymentProof = rejectPaymentProof;
exports.expireUnpaidOrders = expireUnpaidOrders;
const paymentProof_1 = require("./paymentProof");
// ─── Manual mobile-money payment workflow ───────────────────────────────────
// See paymentProof.ts for the overall flow. Every write is a compare-and-set
// inside one transaction, so two admins (or an admin and the expiry job) can
// never both act on the same order: the loser gets a 409 / is skipped.
class PaymentError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.isOperational = true;
        this.name = 'PaymentError';
        this.statusCode = statusCode;
    }
}
exports.PaymentError = PaymentError;
/* eslint-enable @typescript-eslint/no-explicit-any */
const isUniqueViolation = (e) => typeof e === 'object' && e !== null && e.code === 'P2002';
async function submitPaymentProof(db, a) {
    const v = (0, paymentProof_1.validateProofInput)(a.input);
    if (v.ok === false)
        throw new PaymentError(400, v.message);
    const now = a.now ?? new Date();
    return db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { id: a.orderId }, include: { payment: true } });
        if (!order)
            throw new PaymentError(404, 'Order not found');
        if (order.buyerId !== a.userId)
            throw new PaymentError(403, 'Forbidden');
        const payment = order.payment;
        if (!payment || payment.method !== 'MOBILE_MONEY') {
            throw new PaymentError(409, 'This order is not paid by mobile money.');
        }
        if (payment.status === 'COMPLETED')
            throw new PaymentError(409, 'This order has already been paid.');
        if ((0, paymentProof_1.isExpiredUnpaid)(order, payment)) {
            // LATE payment: the sweep cancelled the order, but the buyer says they paid.
            // Accept the claim for a limited time so an admin can confirm and reinstate.
            if (!(0, paymentProof_1.withinLateProofWindow)(order.cancelledAt, now)) {
                throw new PaymentError(409, 'This order was cancelled too long ago to be reinstated. Please contact support with your transaction ID.');
            }
        }
        else {
            if (order.status !== 'PENDING' || payment.status !== 'PENDING') {
                throw new PaymentError(409, 'This order can no longer accept a payment. If you already paid, contact support with your transaction ID.');
            }
            if (payment.dueAt && now.getTime() > new Date(payment.dueAt).getTime()) {
                throw new PaymentError(409, 'The payment window for this order has closed. If you already paid, contact support with your transaction ID.');
            }
        }
        if ((await tx.paymentProof.count({ where: { orderId: order.id, status: 'SUBMITTED' } })) > 0) {
            throw new PaymentError(409, 'Your payment details are already awaiting confirmation.');
        }
        if ((await tx.paymentProof.count({ where: { orderId: order.id } })) >= paymentProof_1.MAX_PROOFS_PER_ORDER) {
            throw new PaymentError(429, 'Too many submissions for this order. Please contact support.');
        }
        try {
            return await tx.paymentProof.create({
                data: {
                    paymentId: payment.id,
                    orderId: order.id,
                    transactionId: v.value.transactionId,
                    senderPhone: v.value.senderPhone,
                    amountClaimed: v.value.amountClaimed,
                    status: 'SUBMITTED',
                },
            });
        }
        catch (e) {
            // Backed by a partial UNIQUE index (non-rejected proofs only): one MTN
            // transaction can pay for one order, even under simultaneous requests.
            if (isUniqueViolation(e)) {
                throw new PaymentError(409, 'This transaction ID has already been used. Check the ID, or contact support.');
            }
            throw e;
        }
    });
}
async function confirmPaymentProof(db, a) {
    const received = typeof a.amountReceived === 'string' ? Number(a.amountReceived.replace(/,/g, '')) : a.amountReceived;
    if (typeof received !== 'number' || !Number.isFinite(received)) {
        throw new PaymentError(400, 'Enter the amount that actually arrived on the MTN statement.');
    }
    const now = a.now ?? new Date();
    return db.$transaction(async (tx) => {
        const proof = await tx.paymentProof.findUnique({ where: { id: a.proofId } });
        if (!proof)
            throw new PaymentError(404, 'Payment proof not found');
        if (proof.status !== 'SUBMITTED')
            throw new PaymentError(409, `This proof was already ${String(proof.status).toLowerCase()}.`);
        const order = await tx.order.findUnique({ where: { id: proof.orderId }, include: { payment: true } });
        if (!order || !order.payment)
            throw new PaymentError(404, 'Order not found');
        // Normal case: the order is still waiting for payment. Late case: the expiry
        // sweep cancelled it but the money did arrive -> confirming REINSTATES it.
        const reinstate = (0, paymentProof_1.isExpiredUnpaid)(order, order.payment);
        const awaiting = order.status === 'PENDING' && order.payment.status === 'PENDING';
        if (!awaiting && !reinstate) {
            throw new PaymentError(409, 'This order is no longer awaiting payment.');
        }
        const check = (0, paymentProof_1.checkAmountReceived)(order.payment.amount, received);
        if (check.ok === false) {
            throw new PaymentError(409, `Underpaid: ${check.shortBy} short of the order total. Reject the proof or ask the buyer to top up.`);
        }
        const p = await tx.paymentProof.updateMany({
            where: { id: proof.id, status: 'SUBMITTED' },
            data: {
                status: 'CONFIRMED',
                amountReceived: received,
                reviewedById: a.adminId,
                reviewedAt: now,
                reviewNote: a.note ?? null,
            },
        });
        if (p.count !== 1)
            throw new PaymentError(409, 'Another admin just reviewed this proof.');
        const pay = await tx.payment.updateMany({
            where: { id: order.payment.id, status: reinstate ? 'FAILED' : 'PENDING' },
            data: {
                status: 'COMPLETED',
                paidAt: now,
                gatewayRef: proof.transactionId,
                gatewayData: {
                    channel: 'MANUAL_MTN',
                    ...(reinstate ? { reinstatedLate: true } : {}),
                    proofId: proof.id,
                    senderPhone: proof.senderPhone,
                    amountClaimed: proof.amountClaimed,
                    amountReceived: received,
                    confirmedBy: a.adminId,
                },
            },
        });
        if (pay.count !== 1)
            throw new PaymentError(409, 'This payment was just changed by someone else.');
        // Paid -> the order may proceed. Compare-and-set on PENDING so an order the
        // expiry job cancelled a moment ago is not resurrected.
        const o = await tx.order.updateMany({
            where: { id: order.id, status: reinstate ? 'CANCELLED' : 'PENDING' },
            data: { status: 'CONFIRMED', ...(reinstate ? { cancelledAt: null, cancellationNote: null } : {}) },
        });
        if (o.count !== 1)
            throw new PaymentError(409, 'This order was just changed by someone else.');
        await tx.notification.create({
            data: {
                userId: order.buyerId,
                type: 'PAYMENT_RECEIVED',
                title: reinstate ? 'Payment confirmed — order reinstated' : 'Payment confirmed',
                message: reinstate
                    ? `We received your payment for order ${order.orderNumber}. The order has been reinstated and the seller will now prepare it.`
                    : `We received your payment for order ${order.orderNumber}. The seller will now prepare it.`,
                data: { orderId: order.id },
            },
        });
        if (reinstate) {
            // The seller saw this order get cancelled — tell them it is back.
            await tx.notification.create({
                data: {
                    userId: order.sellerId,
                    type: 'ORDER_CONFIRMED',
                    title: 'Order reinstated',
                    message: `Order ${order.orderNumber} was reinstated: the buyer's payment arrived after the deadline and has been confirmed. Please prepare it.`,
                    data: { orderId: order.id },
                },
            });
        }
        return {
            orderId: order.id,
            orderNumber: order.orderNumber,
            buyerId: order.buyerId,
            ...(check.overpaidBy > 0 ? { overpaidBy: check.overpaidBy } : {}),
            ...(reinstate ? { reinstated: true } : {}),
        };
    });
}
async function rejectPaymentProof(db, a) {
    const reason = typeof a.reason === 'string' ? a.reason.trim() : '';
    if (reason.length < 3)
        throw new PaymentError(400, 'Give the buyer a reason (e.g. "no matching payment on the MTN statement").');
    const now = a.now ?? new Date();
    return db.$transaction(async (tx) => {
        const proof = await tx.paymentProof.findUnique({ where: { id: a.proofId } });
        if (!proof)
            throw new PaymentError(404, 'Payment proof not found');
        if (proof.status !== 'SUBMITTED')
            throw new PaymentError(409, `This proof was already ${String(proof.status).toLowerCase()}.`);
        const order = await tx.order.findUnique({ where: { id: proof.orderId }, include: { payment: true } });
        if (!order || !order.payment)
            throw new PaymentError(404, 'Order not found');
        const r = await tx.paymentProof.updateMany({
            where: { id: proof.id, status: 'SUBMITTED' },
            data: { status: 'REJECTED', reviewedById: a.adminId, reviewedAt: now, reviewNote: reason.slice(0, 500) },
        });
        if (r.count !== 1)
            throw new PaymentError(409, 'Another admin just reviewed this proof.');
        // A rejection must not leave the buyer with an already-expired window:
        // give a fresh one so they can correct a typo and resubmit.
        if (order.status === 'PENDING' && order.payment.status === 'PENDING') {
            const fresh = (0, paymentProof_1.computeDueAt)(now, a.deadlineMinutes);
            const current = order.payment.dueAt ? new Date(order.payment.dueAt) : null;
            if (!current || fresh.getTime() > current.getTime()) {
                await tx.payment.updateMany({ where: { id: order.payment.id, status: 'PENDING' }, data: { dueAt: fresh } });
            }
        }
        await tx.notification.create({
            data: {
                userId: order.buyerId,
                type: 'PAYMENT_FAILED',
                title: 'Payment not confirmed',
                message: `We could not confirm your payment for order ${order.orderNumber}: ${reason}. You can correct the details and submit again.`,
                data: { orderId: order.id },
            },
        });
        return { orderId: order.id, orderNumber: order.orderNumber, buyerId: order.buyerId };
    });
}
/**
 * Cancels mobile-money orders whose payment window has passed with NO proof
 * waiting for review. Safe to run on every instance every minute: each order
 * is cancelled by a compare-and-set on status PENDING, so it happens once.
 * An order with a SUBMITTED proof is never expired — it waits for an admin.
 */
async function expireUnpaidOrders(db, opts = {}) {
    const now = opts.now ?? new Date();
    const overdue = await db.payment.findMany({
        where: { method: 'MOBILE_MONEY', status: 'PENDING', dueAt: { lt: now } },
        select: { id: true, orderId: true },
        take: opts.batch ?? 100,
    });
    const cancelled = [];
    let skipped = 0;
    for (const p of overdue) {
        const did = await db.$transaction(async (tx) => {
            if ((await tx.paymentProof.count({ where: { orderId: p.orderId, status: 'SUBMITTED' } })) > 0)
                return false;
            const o = await tx.order.updateMany({
                where: { id: p.orderId, status: 'PENDING' },
                data: { status: 'CANCELLED', cancelledAt: now, cancellationNote: 'Payment was not received within the payment window.' },
            });
            if (o.count !== 1)
                return false;
            await tx.payment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'FAILED' } });
            const order = await tx.order.findUnique({ where: { id: p.orderId } });
            if (order) {
                await tx.notification.create({
                    data: {
                        userId: order.buyerId,
                        type: 'ORDER_CANCELLED',
                        title: 'Order cancelled — payment not received',
                        message: `Order ${order.orderNumber} was cancelled because payment was not received in time. If you already paid, contact support with your MTN transaction ID.`,
                        data: { orderId: order.id },
                    },
                });
            }
            return true;
        });
        if (did)
            cancelled.push(p.orderId);
        else
            skipped++;
    }
    return { cancelled, skipped };
}
//# sourceMappingURL=paymentProofService.js.map