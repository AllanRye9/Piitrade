import { Router, Request, Response, NextFunction } from 'express';
import type { CouponType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { createError } from '../middleware/errorHandler';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Store tools are frozen while the store subscription is not active: the
// owner keeps their account type but can only do ordinary-user things until
// they renew. (Deleting an existing coupon stays allowed.)
async function requireActiveStoreRental(userId: string): Promise<boolean> {
  const rental = await prisma.storeRental.findFirst({
    where: { userId, status: 'ACTIVE', endDate: { gt: new Date() } },
    select: { id: true },
  });
  return Boolean(rental);
}

// GET /api/coupons/validate?code=... — validate a coupon code (public)
router.get('/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = (req.query.code as string)?.trim().toUpperCase();
    if (!code) return next(createError('code is required', 400));

    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon || !coupon.isActive) return next(createError('Invalid coupon code', 404));
    if (coupon.expiresAt && coupon.expiresAt < new Date()) return next(createError('Coupon has expired', 400));
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      return next(createError('Coupon usage limit reached', 400));
    }

    res.json({
      valid: true,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      minOrderAmount: coupon.minOrderAmount,
      expiresAt: coupon.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Web Store "Promotion and discount setup" tool ──────────────────────────
// Store owners manage their own coupons (sellerId scoped) from their
// dashboard. Platform-wide coupons (sellerId null, managed from
// /admin/coupons) are untouched by this section.

// GET /api/coupons/mine — the current user's own store coupons
router.get('/mine', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const coupons = await prisma.coupon.findMany({
      where: { sellerId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ coupons });
  } catch (err) {
    next(err);
  }
});

// POST /api/coupons — create a store-scoped coupon (requires an active Web Store)
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const store = await prisma.store.findUnique({ where: { userId: req.user!.userId } });
    if (!store) return next(createError('Only Web Store owners can create promotions', 403));
    if (!(await requireActiveStoreRental(req.user!.userId))) {
      return next(createError('Your store subscription is not active. Renew it to create promotions.', 403));
    }

    const { code, type, value, minOrderAmount, maxUses, expiresAt, description } = req.body as {
      code?: string; type?: string; value?: number; minOrderAmount?: number;
      maxUses?: number; expiresAt?: string; description?: string;
    };
    if (!code || !code.trim()) return next(createError('A coupon code is required', 400));
    if (!type || !['PERCENTAGE', 'FIXED'].includes(type)) return next(createError('type must be PERCENTAGE or FIXED', 400));
    if (typeof value !== 'number' || value <= 0) return next(createError('value must be a positive number', 400));

    const couponType: CouponType = type === 'FIXED' ? 'FIXED_AMOUNT' : 'PERCENTAGE';

    const normalizedCode = code.trim().toUpperCase();
    const existing = await prisma.coupon.findUnique({ where: { code: normalizedCode } });
    if (existing) return next(createError('That coupon code is already in use', 409));

    const coupon = await prisma.coupon.create({
      data: {
        code:           normalizedCode,
        type:           couponType,
        value,
        minOrderAmount: minOrderAmount ?? null,
        maxUses:        maxUses ?? null,
        expiresAt:      expiresAt ? new Date(expiresAt) : null,
        description:    description?.trim() || null,
        sellerId:       req.user!.userId,
      },
    });
    res.status(201).json({ coupon });
  } catch (err) {
    next(err);
  }
});

// PUT /api/coupons/:id — update one of the store's own coupons
router.put('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.coupon.findUnique({ where: { id: req.params.id } });
    if (!existing) return next(createError('Coupon not found', 404));
    if (existing.sellerId !== req.user!.userId) return next(createError('Forbidden', 403));
    if (!(await requireActiveStoreRental(req.user!.userId))) {
      return next(createError('Your store subscription is not active. Renew it to edit promotions.', 403));
    }

    const { value, minOrderAmount, maxUses, isActive, expiresAt, description } = req.body as {
      value?: number; minOrderAmount?: number; maxUses?: number;
      isActive?: boolean; expiresAt?: string | null; description?: string;
    };

    const coupon = await prisma.coupon.update({
      where: { id: req.params.id },
      data: {
        ...(value          !== undefined && { value }),
        ...(minOrderAmount !== undefined && { minOrderAmount }),
        ...(maxUses        !== undefined && { maxUses }),
        ...(isActive       !== undefined && { isActive: Boolean(isActive) }),
        ...(expiresAt      !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
        ...(description    !== undefined && { description: description?.trim() || null }),
      },
    });
    res.json({ coupon });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/coupons/:id — remove one of the store's own coupons
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.coupon.findUnique({ where: { id: req.params.id } });
    if (!existing) return next(createError('Coupon not found', 404));
    if (existing.sellerId !== req.user!.userId) return next(createError('Forbidden', 403));

    await prisma.coupon.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
