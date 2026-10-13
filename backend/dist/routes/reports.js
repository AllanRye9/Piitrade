"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const router = (0, express_1.Router)();
router.post('/', auth_1.authenticate, async (req, res, next) => {
    try {
        const { listingId, reason } = req.body;
        if (!listingId || !reason)
            return next((0, errorHandler_1.createError)('Missing required fields', 400));
        const cleanReason = String(reason).trim();
        if (cleanReason.length < 5 || cleanReason.length > 1000) {
            return next((0, errorHandler_1.createError)('Please describe the problem in 5–1000 characters', 400));
        }
        const listing = await prisma_1.prisma.listing.findUnique({ where: { id: listingId }, select: { userId: true } });
        if (!listing)
            return next((0, errorHandler_1.createError)('Listing not found', 404));
        if (listing.userId === req.user.userId)
            return next((0, errorHandler_1.createError)('You cannot report your own listing', 400));
        const existing = await prisma_1.prisma.report.findFirst({
            where: { reporterId: req.user.userId, listingId, status: 'OPEN' },
            select: { id: true },
        });
        if (existing)
            return next((0, errorHandler_1.createError)('You have already reported this listing — we are reviewing it', 409));
        const report = await prisma_1.prisma.report.create({
            data: { reporterId: req.user.userId, listingId, reason: cleanReason },
        });
        res.status(201).json(report);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=reports.js.map