import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();

router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { listingId, reason } = req.body;
    if (!listingId || !reason) return next(createError('Missing required fields', 400));
    const cleanReason = String(reason).trim();
    if (cleanReason.length < 5 || cleanReason.length > 1000) {
      return next(createError('Please describe the problem in 5–1000 characters', 400));
    }

    const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { userId: true } });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.userId === req.user!.userId) return next(createError('You cannot report your own listing', 400));

    const existing = await prisma.report.findFirst({
      where: { reporterId: req.user!.userId, listingId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) return next(createError('You have already reported this listing — we are reviewing it', 409));

    const report = await prisma.report.create({
      data: { reporterId: req.user!.userId, listingId, reason: cleanReason },
    });
    res.status(201).json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
