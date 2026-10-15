"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET /api/withdrawals — list seller's withdrawals
router.get('/', async (req, res, next) => {
    try {
        const withdrawals = await prisma_1.prisma.withdrawal.findMany({
            where: { userId: req.user.userId },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ withdrawals });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/withdrawals — request a withdrawal
router.post('/', async (req, res, next) => {
    try {
        const { amount, currency, method, accountInfo } = req.body;
        if (!amount || !accountInfo)
            return next((0, errorHandler_1.createError)('amount and accountInfo are required', 400));
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return next((0, errorHandler_1.createError)('amount must be a positive number', 400));
        }
        // Check available balance
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { balance: true },
        });
        if (!user)
            return next((0, errorHandler_1.createError)('User not found', 404));
        if (user.balance < parsedAmount) {
            return next((0, errorHandler_1.createError)('Insufficient balance', 400));
        }
        const withdrawal = await prisma_1.prisma.$transaction(async (tx) => {
            const w = await tx.withdrawal.create({
                data: {
                    userId: req.user.userId,
                    amount: parsedAmount,
                    currency: currency || 'UGX',
                    method: method || 'BANK_TRANSFER',
                    accountInfo,
                },
            });
            // Deduct from balance immediately to prevent double-withdrawals
            await tx.user.update({
                where: { id: req.user.userId },
                data: { balance: { decrement: parsedAmount } },
            });
            return w;
        });
        res.status(201).json({ withdrawal });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=withdrawals.js.map