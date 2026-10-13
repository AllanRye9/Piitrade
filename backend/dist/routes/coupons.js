"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const errorHandler_1 = require("../middleware/errorHandler");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Store tools are frozen while the store subscription is not active: the
// owner keeps their account type but can only do ordinary-user things until
// they renew. (Deleting an existing coupon stays allowed.)
async function requireActiveStoreRental(userId) {
    const rental = await prisma_1.prisma.storeRental.findFirst({
        where: { userId, status: 'ACTIVE', endDate: { gt: new Date() } },
        select: { id: true },
    });
    return Boolean(rental);
}
// GET /api/coupons/validate?code=... — validate a coupon code (public)
router.get('/validate', async (req, res, next) => {
    try {
        const code = req.query.code?.trim().toUpperCase();
        if (!code)
            return next((0, errorHandler_1.createError)('code is required', 400));
        const coupon = await prisma_1.prisma.coupon.findUnique({ where: { code } });
        if (!coupon || !coupon.isActive)
            return next((0, errorHandler_1.createError)('Invalid coupon code', 404));
        if (coupon.expiresAt && coupon.expiresAt < new Date())
            return next((0, errorHandler_1.createError)('Coupon has expired', 400));
        if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
            return next((0, errorHandler_1.createError)('Coupon usage limit reached', 400));
        }
        res.json({
            valid: true,
            code: coupon.code,
            type: coupon.type,
            value: coupon.value,
            minOrderAmount: coupon.minOrderAmount,
            expiresAt: coupon.expiresAt,
        });
    }
    catch (err) {
        next(err);
    }
});
// ─── Web Store "Promotion and discount setup" tool ──────────────────────────
// Store owners manage their own coupons (sellerId scoped) from their
// dashboard. Platform-wide coupons (sellerId null, managed from
// /admin/coupons) are untouched by this section.
// GET /api/coupons/mine — the current user's own store coupons
router.get('/mine', auth_1.authenticate, async (req, res, next) => {
    try {
        const coupons = await prisma_1.prisma.coupon.findMany({
            where: { sellerId: req.user.userId },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ coupons });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/coupons — create a store-scoped coupon (requires an active Web Store)
router.post('/', auth_1.authenticate, async (req, res, next) => {
    try {
        const store = await prisma_1.prisma.store.findUnique({ where: { userId: req.user.userId } });
        if (!store)
            return next((0, errorHandler_1.createError)('Only Web Store owners can create promotions', 403));
        if (!(await requireActiveStoreRental(req.user.userId))) {
            return next((0, errorHandler_1.createError)('Your store subscription is not active. Renew it to create promotions.', 403));
        }
        const { code, type, value, minOrderAmount, maxUses, expiresAt, description } = req.body;
        if (!code || !code.trim())
            return next((0, errorHandler_1.createError)('A coupon code is required', 400));
        if (!type || !['PERCENTAGE', 'FIXED'].includes(type))
            return next((0, errorHandler_1.createError)('type must be PERCENTAGE or FIXED', 400));
        if (typeof value !== 'number' || value <= 0)
            return next((0, errorHandler_1.createError)('value must be a positive number', 400));
        const couponType = type === 'FIXED' ? 'FIXED_AMOUNT' : 'PERCENTAGE';
        const normalizedCode = code.trim().toUpperCase();
        const existing = await prisma_1.prisma.coupon.findUnique({ where: { code: normalizedCode } });
        if (existing)
            return next((0, errorHandler_1.createError)('That coupon code is already in use', 409));
        const coupon = await prisma_1.prisma.coupon.create({
            data: {
                code: normalizedCode,
                type: couponType,
                value,
                minOrderAmount: minOrderAmount ?? null,
                maxUses: maxUses ?? null,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                description: description?.trim() || null,
                sellerId: req.user.userId,
            },
        });
        res.status(201).json({ coupon });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/coupons/:id — update one of the store's own coupons
router.put('/:id', auth_1.authenticate, async (req, res, next) => {
    try {
        const existing = await prisma_1.prisma.coupon.findUnique({ where: { id: req.params.id } });
        if (!existing)
            return next((0, errorHandler_1.createError)('Coupon not found', 404));
        if (existing.sellerId !== req.user.userId)
            return next((0, errorHandler_1.createError)('Forbidden', 403));
        if (!(await requireActiveStoreRental(req.user.userId))) {
            return next((0, errorHandler_1.createError)('Your store subscription is not active. Renew it to edit promotions.', 403));
        }
        const { value, minOrderAmount, maxUses, isActive, expiresAt, description } = req.body;
        const coupon = await prisma_1.prisma.coupon.update({
            where: { id: req.params.id },
            data: {
                ...(value !== undefined && { value }),
                ...(minOrderAmount !== undefined && { minOrderAmount }),
                ...(maxUses !== undefined && { maxUses }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) }),
                ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
                ...(description !== undefined && { description: description?.trim() || null }),
            },
        });
        res.json({ coupon });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/coupons/:id — remove one of the store's own coupons
router.delete('/:id', auth_1.authenticate, async (req, res, next) => {
    try {
        const existing = await prisma_1.prisma.coupon.findUnique({ where: { id: req.params.id } });
        if (!existing)
            return next((0, errorHandler_1.createError)('Coupon not found', 404));
        if (existing.sellerId !== req.user.userId)
            return next((0, errorHandler_1.createError)('Forbidden', 403));
        await prisma_1.prisma.coupon.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=coupons.js.map