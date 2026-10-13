import { quantityProblem } from '../utils/orderQuantity';
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { findActiveStoreOwnerIds, StoreLookupDb } from '../utils/checkoutPolicy';

const router = Router();

router.use(authenticate);

// GET /api/cart — list current user's cart items
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.cartItem.findMany({
      where: { userId: req.user!.userId },
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
    const storeOwnerIds = await findActiveStoreOwnerIds(
      prisma as unknown as StoreLookupDb,
      items.map((i) => i.listing.userId),
    );
    res.json({
      items: items.map((i) => ({
        ...i,
        listing: { ...i.listing, user: { ...i.listing.user, hasActiveStore: storeOwnerIds.has(i.listing.userId) } },
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cart — add or increment a listing in the cart
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { listingId, quantity = 1 } = req.body;
    if (!listingId) return next(createError('listingId is required', 400));

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.status !== 'ACTIVE') return next(createError('Listing is not available', 400));

    const addQty = Number(quantity);
    if (!Number.isFinite(addQty) || addQty < 1) return next(createError('Quantity must be at least 1', 400));

    const existing = await prisma.cartItem.findUnique({
      where: { userId_listingId: { userId: req.user!.userId, listingId } },
    });

    // Wholesale listings (Agriculture) have a minimum order quantity: a first
    // add below it is raised to the minimum rather than rejected, so a quick
    // "add to cart" always lands a valid line.
    const moq = listing.minOrderQuantity ?? 1;

    let item;
    if (existing) {
      item = await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: Math.max(moq, existing.quantity + addQty) },
      });
    } else {
      item = await prisma.cartItem.create({
        data: { userId: req.user!.userId, listingId, quantity: Math.max(moq, addQty) },
      });
    }

    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

// PUT /api/cart/:id — update quantity of a cart item
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { quantity } = req.body;
    if (quantity == null) return next(createError('quantity is required', 400));

    const existing = await prisma.cartItem.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.userId) {
      return next(createError('Cart item not found', 404));
    }

    if (Number(quantity) < 1) {
      await prisma.cartItem.delete({ where: { id: req.params.id } });
      return res.json({ message: 'Item removed from cart' });
    }

    const cartListing = await prisma.listing.findUnique({
      where: { id: existing.listingId },
      select: { title: true, minOrderQuantity: true },
    });
    const problem = cartListing ? quantityProblem(cartListing, Number(quantity)) : null;
    if (problem) return next(createError(problem, 400));

    const item = await prisma.cartItem.update({
      where: { id: req.params.id },
      data: { quantity: Number(quantity) },
    });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cart/:id — remove a single cart item
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.cartItem.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user!.userId) {
      return next(createError('Cart item not found', 404));
    }
    await prisma.cartItem.delete({ where: { id: req.params.id } });
    res.json({ message: 'Removed from cart' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cart — clear entire cart
router.delete('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.cartItem.deleteMany({ where: { userId: req.user!.userId } });
    res.json({ message: 'Cart cleared' });
  } catch (err) {
    next(err);
  }
});

export default router;
