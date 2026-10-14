"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const checkoutPolicy_1 = require("../utils/checkoutPolicy");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
// GET /api/cart — list current user's cart items
router.get('/', async (req, res, next) => {
    try {
        const items = await prisma_1.prisma.cartItem.findMany({
            where: { userId: req.user.userId },
            include: {
                listing: {
                    include: {
                        category: { select: { id: true, name: true, slug: true } },
                        user: { select: { id: true, name: true, avatar: true, role: true } },
                        productImages: {
                            where: { status: 'APPROVED' },
                            select: { id: true, cdnUrl: true },
                            take: 1,
                        },
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });
        // Tell the UI which sellers are web stores, so it applies the same
        // checkout rule as POST /orders (see utils/checkoutPolicy).
        const storeOwnerIds = await (0, checkoutPolicy_1.findActiveStoreOwnerIds)(prisma_1.prisma, items.map((i) => i.listing.userId));
        res.json({
            items: items.map((i) => ({
                ...i,
                listing: { ...i.listing, user: { ...i.listing.user, hasActiveStore: storeOwnerIds.has(i.listing.userId) } },
            })),
        });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/cart — add or increment a listing in the cart
router.post('/', async (req, res, next) => {
    try {
        const { listingId, quantity = 1 } = req.body;
        if (!listingId)
            return next((0, errorHandler_1.createError)('listingId is required', 400));
        const listing = await prisma_1.prisma.listing.findUnique({ where: { id: listingId } });
        if (!listing)
            return next((0, errorHandler_1.createError)('Listing not found', 404));
        if (listing.status !== 'ACTIVE')
            return next((0, errorHandler_1.createError)('Listing is not available', 400));
        const existing = await prisma_1.prisma.cartItem.findUnique({
            where: { userId_listingId: { userId: req.user.userId, listingId } },
        });
        let item;
        if (existing) {
            item = await prisma_1.prisma.cartItem.update({
                where: { id: existing.id },
                data: { quantity: existing.quantity + Number(quantity) },
            });
        }
        else {
            item = await prisma_1.prisma.cartItem.create({
                data: { userId: req.user.userId, listingId, quantity: Number(quantity) },
            });
        }
        res.status(201).json({ item });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/cart/:id — update quantity of a cart item
router.put('/:id', async (req, res, next) => {
    try {
        const { quantity } = req.body;
        if (quantity == null)
            return next((0, errorHandler_1.createError)('quantity is required', 400));
        const existing = await prisma_1.prisma.cartItem.findUnique({ where: { id: req.params.id } });
        if (!existing || existing.userId !== req.user.userId) {
            return next((0, errorHandler_1.createError)('Cart item not found', 404));
        }
        if (Number(quantity) < 1) {
            await prisma_1.prisma.cartItem.delete({ where: { id: req.params.id } });
            return res.json({ message: 'Item removed from cart' });
        }
        const item = await prisma_1.prisma.cartItem.update({
            where: { id: req.params.id },
            data: { quantity: Number(quantity) },
        });
        res.json({ item });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/cart/:id — remove a single cart item
router.delete('/:id', async (req, res, next) => {
    try {
        const existing = await prisma_1.prisma.cartItem.findUnique({ where: { id: req.params.id } });
        if (!existing || existing.userId !== req.user.userId) {
            return next((0, errorHandler_1.createError)('Cart item not found', 404));
        }
        await prisma_1.prisma.cartItem.delete({ where: { id: req.params.id } });
        res.json({ message: 'Removed from cart' });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /api/cart — clear entire cart
router.delete('/', async (req, res, next) => {
    try {
        await prisma_1.prisma.cartItem.deleteMany({ where: { userId: req.user.userId } });
        res.json({ message: 'Cart cleared' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=cart.js.map