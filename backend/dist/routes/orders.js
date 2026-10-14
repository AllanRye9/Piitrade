"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../utils/prisma");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const uuid_1 = require("uuid");
const orderStatusService_1 = require("../utils/orderStatusService");
const checkoutPolicy_1 = require("../utils/checkoutPolicy");
const deliveryCode_1 = require("../utils/deliveryCode");
const paymentProof_1 = require("../utils/paymentProof");
const router = (0, express_1.Router)();
/** Generates a human-readable order number like ORD-2026-XXXXXX */
function generateOrderNumber() {
    const year = new Date().getFullYear();
    const rand = (0, uuid_1.v4)().replace(/-/g, '').substring(0, 6).toUpperCase();
    return `ORD-${year}-${rand}`;
}
// ─── Buyer routes ─────────────────────────────────────────────────────────────
// POST /api/orders — place a new order
router.post('/', auth_1.authenticate, async (req, res, next) => {
    try {
        const { items, // [{ listingId, quantity, selectedColor?, selectedSize?, selectedAttributes? }]
        shippingAddressId, billingAddressId, couponCode, paymentMethod, notes, currency, } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return next((0, errorHandler_1.createError)('Order must contain at least one item', 400));
        }
        // Validate coupon if provided
        let coupon = null;
        if (couponCode) {
            coupon = await prisma_1.prisma.coupon.findUnique({ where: { code: couponCode.trim().toUpperCase() } });
            if (!coupon || !coupon.isActive)
                return next((0, errorHandler_1.createError)('Invalid or inactive coupon', 400));
            if (coupon.expiresAt && coupon.expiresAt < new Date())
                return next((0, errorHandler_1.createError)('Coupon has expired', 400));
            if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
                return next((0, errorHandler_1.createError)('Coupon usage limit reached', 400));
            }
        }
        // Resolve listings and build order items
        const listingIds = items.map((i) => i.listingId);
        const listings = await prisma_1.prisma.listing.findMany({
            where: { id: { in: listingIds }, status: 'ACTIVE' },
            include: {
                productImages: { where: { status: 'APPROVED' }, select: { cdnUrl: true }, take: 1 },
                category: { select: { slug: true, parent: { select: { slug: true } } } },
                user: { select: { role: true } },
            },
        });
        if (listings.length !== listingIds.length) {
            return next((0, errorHandler_1.createError)('One or more listings are unavailable', 400));
        }
        // Buy-via-cart eligibility — the real enforcement for the site's
        // Classifieds/E-commerce/Hybrid mode (see the marketplaceMode field's
        // comment in schema.prisma). Mirrors isCheckoutEligible() in
        // frontend/lib/utils.ts exactly, so a listing the UI hides the Buy Now
        // button for can never be ordered by calling this endpoint directly
        // either — the mode is a real guarantee, not just a hidden button.
        const siteConfig = await prisma_1.prisma.siteConfig.findUnique({ where: { id: 'global' }, select: { marketplaceMode: true, paymentSettings: true } });
        // Checkout is for web stores (active store rental) and Piitrade itself;
        // every other seller is contact/chat only. Rule lives in utils/checkoutPolicy.
        const storeOwnerIds = await (0, checkoutPolicy_1.findActiveStoreOwnerIds)(prisma_1.prisma, listings.map((l) => l.userId));
        const ineligible = listings.find((l) => !(0, checkoutPolicy_1.isCheckoutEligible)({
            mode: siteConfig?.marketplaceMode,
            topCategorySlug: l.category?.parent?.slug || l.category?.slug,
            sellerIsAdmin: l.user.role === 'ADMIN',
            sellerHasActiveStore: storeOwnerIds.has(l.userId),
        }));
        if (ineligible) {
            return next((0, errorHandler_1.createError)(`"${ineligible.title}" isn't available for checkout — contact the seller directly instead.`, 400));
        }
        // All items must belong to the same seller (for simplicity; multi-seller orders
        // would require splitting into separate orders — handled in a future iteration).
        const sellerIds = [...new Set(listings.map((l) => l.userId))];
        if (sellerIds.length > 1) {
            return next((0, errorHandler_1.createError)('All items in an order must be from the same seller', 400));
        }
        const sellerId = sellerIds[0];
        // Which payment methods are allowed is decided HERE, not by the client:
        // only manual MTN mobile money (and cash on delivery for Piitrade's own
        // listings). Anything else could never be paid yet would still pay the seller.
        const payCfg = (siteConfig?.paymentSettings ?? {});
        const methodDecision = (0, paymentProof_1.resolvePaymentMethod)({
            requested: paymentMethod,
            mobileMoneyEnabled: payCfg.mobileMoneyEnabled !== false,
            codEnabled: payCfg.codEnabled !== false,
            sellerIsAdmin: listings[0].user.role === 'ADMIN',
        });
        if (methodDecision.ok === false)
            return next((0, errorHandler_1.createError)(methodDecision.message, 400));
        const chosenMethod = methodDecision.method;
        const paymentDueAt = chosenMethod === 'MOBILE_MONEY'
            ? (0, paymentProof_1.computeDueAt)(new Date(), (0, paymentProof_1.resolveDeadlineMinutes)(payCfg.paymentDeadlineMinutes))
            : null;
        if (sellerId === req.user.userId) {
            return next((0, errorHandler_1.createError)('You cannot order your own listings', 400));
        }
        let subtotal = 0;
        const orderItemsData = items.map((item) => {
            const listing = listings.find((l) => l.id === item.listingId);
            const qty = Math.max(1, Number(item.quantity) || 1);
            subtotal += listing.price * qty;
            // Build a human-readable variants summary for logistics / admin fulfilment.
            const variantParts = [];
            if (item.selectedColor)
                variantParts.push(`Colour: ${item.selectedColor}`);
            if (item.selectedSize)
                variantParts.push(`Size: ${item.selectedSize}`);
            if (item.selectedAttributes) {
                for (const [k, v] of Object.entries(item.selectedAttributes)) {
                    if (v)
                        variantParts.push(`${k}: ${v}`);
                }
            }
            return {
                listingId: listing.id,
                title: listing.title,
                price: listing.price,
                quantity: qty,
                currency: listing.currency,
                imageUrl: listing.productImages[0]?.cdnUrl ?? listing.images[0] ?? null,
                // Variant summary stored as a note so it surfaces in admin order views
                // without requiring a DB schema change.
                ...(variantParts.length > 0 ? { variantSummary: variantParts.join(' | ') } : {}),
            };
        });
        // Apply coupon discount
        let discount = 0;
        if (coupon) {
            if (coupon.type === 'PERCENTAGE')
                discount = subtotal * (coupon.value / 100);
            else if (coupon.type === 'FIXED_AMOUNT')
                discount = Math.min(coupon.value, subtotal);
            // FREE_SHIPPING handled at checkout UI level (shippingCost = 0)
        }
        if (coupon?.minOrderAmount && subtotal < coupon.minOrderAmount) {
            return next((0, errorHandler_1.createError)(`Minimum order amount for this coupon is ${coupon.minOrderAmount}`, 400));
        }
        const shippingCost = 0; // shipping calculated by admin-configured ShippingRate table
        const tax = 0; // tax logic can be added per region
        const total = Math.max(0, subtotal - discount + shippingCost + tax);
        const order = await prisma_1.prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
                data: {
                    orderNumber: generateOrderNumber(),
                    buyerId: req.user.userId,
                    sellerId,
                    currency: currency || 'UGX',
                    subtotal,
                    discount,
                    shippingCost,
                    tax,
                    total,
                    notes,
                    ...(shippingAddressId && { shippingAddressId }),
                    ...(billingAddressId && { billingAddressId }),
                    ...(coupon && { couponId: coupon.id }),
                    items: { create: orderItemsData },
                    payment: {
                        create: {
                            method: chosenMethod,
                            status: 'PENDING',
                            amount: total,
                            currency: currency || 'UGX',
                            ...(paymentDueAt && { dueAt: paymentDueAt }),
                        },
                    },
                },
                include: {
                    items: true,
                    payment: true,
                    shippingAddress: true,
                },
            });
            // Increment coupon usage
            if (coupon) {
                await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
            }
            // Clear server-side cart items for this user+listings
            await tx.cartItem.deleteMany({
                where: { userId: req.user.userId, listingId: { in: listingIds } },
            });
            // Build a rich order detail object for notifications (product options + all details).
            // Cast to Prisma.InputJsonValue: Prisma's Json fields require a value assignable to
            // InputJsonValue, which does not accept `unknown` — even though variantSummary here
            // is always either a string or null at runtime.
            const orderDetails = {
                orderId: newOrder.id,
                orderNumber: newOrder.orderNumber,
                total: newOrder.total,
                currency: newOrder.currency,
                items: orderItemsData.map((oi) => ({
                    title: oi.title,
                    quantity: oi.quantity,
                    price: oi.price,
                    variantSummary: (oi.variantSummary ?? null),
                })),
            };
            // Collect admin user IDs to notify
            const admins = await tx.user.findMany({
                where: { role: 'ADMIN' },
                select: { id: true },
            });
            const notificationRows = [
                {
                    userId: req.user.userId,
                    type: 'ORDER_PLACED',
                    title: 'Order placed',
                    message: `Your order ${newOrder.orderNumber} has been placed successfully.`,
                    data: orderDetails,
                },
                {
                    userId: sellerId,
                    type: 'ORDER_PLACED',
                    title: 'New order received',
                    message: `New order ${newOrder.orderNumber} received. Check your dashboard for product option details.`,
                    data: orderDetails,
                },
                ...admins.map((admin) => ({
                    userId: admin.id,
                    type: 'ORDER_PLACED',
                    title: 'New order (admin)',
                    message: `Order ${newOrder.orderNumber} placed. All product options are included in data.`,
                    data: orderDetails,
                })),
            ];
            // Deduplicate: if seller is also admin, avoid double notification
            const seen = new Set();
            const dedupedRows = notificationRows.filter((r) => {
                if (seen.has(r.userId))
                    return false;
                seen.add(r.userId);
                return true;
            });
            await tx.notification.createMany({ data: dedupedRows });
            return newOrder;
        });
        res.status(201).json({ order });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/orders — list orders for the current user (buyer or seller)
router.get('/', auth_1.authenticate, async (req, res, next) => {
    try {
        const { role = 'buyer', status, page = '1', limit = '20' } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;
        const isSeller = role === 'seller';
        const where = {
            ...(isSeller ? { sellerId: req.user.userId } : { buyerId: req.user.userId }),
            ...(status && { status: status }),
        };
        const [orders, total] = await Promise.all([
            prisma_1.prisma.order.findMany({
                where,
                include: {
                    items: { include: { listing: { select: { id: true, title: true, images: true } } } },
                    payment: { select: { status: true, method: true } },
                    shippingAddress: true,
                    buyer: { select: { id: true, name: true, avatar: true, email: true } },
                    seller: { select: { id: true, name: true, avatar: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum,
            }),
            prisma_1.prisma.order.count({ where }),
        ]);
        res.json({ orders, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/orders/:id — get a single order
router.get('/:id', auth_1.authenticate, async (req, res, next) => {
    try {
        const order = await prisma_1.prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                items: { include: { listing: { select: { id: true, title: true, images: true, productImages: { where: { status: 'APPROVED' }, select: { cdnUrl: true }, take: 1 } } } } },
                payment: true,
                shippingAddress: true,
                billingAddress: true,
                coupon: { select: { code: true, type: true, value: true } },
                buyer: { select: { id: true, name: true, avatar: true, email: true, phone: true } },
                seller: { select: { id: true, name: true, avatar: true, email: true, phone: true } },
                returns: true,
            },
        });
        if (!order)
            return next((0, errorHandler_1.createError)('Order not found', 404));
        if (order.buyerId !== req.user.userId && order.sellerId !== req.user.userId && req.user.role !== 'ADMIN') {
            return next((0, errorHandler_1.createError)('Forbidden', 403));
        }
        // The delivery code is the CUSTOMER's proof of receipt: only the buyer
        // (and an admin, for support) ever receives it — never the seller — and
        // only while the order is still open.
        const secret = (0, deliveryCode_1.resolveDeliveryCodeSecret)();
        const mayViewCode = order.buyerId === req.user.userId || req.user.role === 'ADMIN';
        const open = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'].includes(order.status);
        const extra = {};
        if (secret && mayViewCode && open)
            extra.deliveryCode = (0, deliveryCode_1.deriveDeliveryCode)(order.id, secret);
        // Manual MTN payment: show the buyer (and admin) where to send the money and
        // what they have submitted. Never shown to the seller.
        if (mayViewCode && order.payment?.method === 'MOBILE_MONEY') {
            const cfg = await prisma_1.prisma.siteConfig.findUnique({ where: { id: 'global' }, select: { paymentSettings: true } });
            const ps = (cfg?.paymentSettings ?? {});
            extra.paymentInfo = {
                number: typeof ps.mobileMoneyNumber === 'string' ? ps.mobileMoneyNumber : '',
                accountName: typeof ps.mobileMoneyAccountName === 'string' ? ps.mobileMoneyAccountName : '',
                instructions: typeof ps.mobileMoneyInstructions === 'string' ? ps.mobileMoneyInstructions : '',
                dueAt: order.payment.dueAt ?? null,
            };
            extra.paymentProofs = await prisma_1.prisma.paymentProof.findMany({
                where: { orderId: order.id },
                orderBy: { createdAt: 'desc' },
                select: { id: true, transactionId: true, senderPhone: true, amountClaimed: true, status: true, reviewNote: true, createdAt: true },
            });
        }
        res.json({ order: { ...order, ...extra } });
    }
    catch (err) {
        next(err);
    }
});
// PUT /api/orders/:id/status — update order status (seller or admin)
router.put('/:id/status', auth_1.authenticate, async (req, res, next) => {
    try {
        const { status, trackingNumber, cancellationNote } = req.body;
        if (!status)
            return next((0, errorHandler_1.createError)('status is required', 400));
        const order = await prisma_1.prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order)
            return next((0, errorHandler_1.createError)('Order not found', 404));
        // Who is acting? Someone who is neither an admin, the order's seller, nor
        // its buyer has no business changing it.
        const actor = req.user.role === 'ADMIN' ? 'ADMIN'
            : order.sellerId === req.user.userId ? 'SELLER'
                : order.buyerId === req.user.userId ? 'BUYER'
                    : null;
        if (!actor)
            return next((0, errorHandler_1.createError)('Forbidden', 403));
        // Legal transitions, who may make them, and the atomic once-only seller
        // payout (with platform fee) live in utils/orderStatusService — shared by
        // PUT /orders/:id/status and PUT /admin/orders/:id/status. Throws a
        // 400/403/409 error for illegal, forbidden or conflicting changes.
        const { order: updated, changed } = await (0, orderStatusService_1.changeOrderStatus)(prisma_1.prisma, order, status, actor, {
            trackingNumber,
            cancellationNote,
            deliveryCode: req.body.deliveryCode,
            overrideReason: req.body.overrideReason,
            refundReason: req.body.refundReason,
            actorUserId: req.user.userId,
        }, {
            sellerCanMarkDelivered: process.env.ORDER_SELLER_CAN_MARK_DELIVERED !== 'false',
            requireDeliveryProof: process.env.ORDER_REQUIRE_DELIVERY_CODE !== 'false',
            deliveryCodeSecret: (0, deliveryCode_1.resolveDeliveryCodeSecret)(),
        });
        // Re-sending the status the order already has is a no-op: don't notify again.
        if (!changed)
            return res.json({ order: updated });
        // Notify buyer of status change
        const notifMap = {
            CONFIRMED: 'ORDER_CONFIRMED',
            SHIPPED: 'ORDER_SHIPPED',
            DELIVERED: 'ORDER_DELIVERED',
            CANCELLED: 'ORDER_CANCELLED',
        };
        if (notifMap[status]) {
            await prisma_1.prisma.notification.create({
                data: {
                    userId: order.buyerId,
                    type: notifMap[status],
                    title: `Order ${status.toLowerCase()}`,
                    message: `Your order ${order.orderNumber} has been ${status.toLowerCase()}.`,
                    data: { orderId: order.id },
                },
            });
        }
        res.json({ order: updated });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/orders/:id/return — buyer requests a return
router.post('/:id/return', auth_1.authenticate, async (req, res, next) => {
    try {
        const order = await prisma_1.prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order)
            return next((0, errorHandler_1.createError)('Order not found', 404));
        if (order.buyerId !== req.user.userId)
            return next((0, errorHandler_1.createError)('Forbidden', 403));
        if (order.status !== 'DELIVERED')
            return next((0, errorHandler_1.createError)('Only delivered orders can be returned', 400));
        const { reason, description, images } = req.body;
        if (!reason)
            return next((0, errorHandler_1.createError)('Reason is required', 400));
        const ret = await prisma_1.prisma.return.create({
            data: {
                orderId: order.id,
                buyerId: req.user.userId,
                reason,
                description,
                images: images || [],
            },
        });
        await prisma_1.prisma.notification.create({
            data: {
                userId: order.sellerId,
                type: 'RETURN_REQUESTED',
                title: 'Return requested',
                message: `Buyer has requested a return for order ${order.orderNumber}.`,
                data: { orderId: order.id, returnId: ret.id },
            },
        });
        res.status(201).json({ return: ret });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=orders.js.map