import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();

// ─── Legacy: User-to-user review (reviewer rates a seller/buyer on a listing) ──

router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { revieweeId, listingId, rating, comment } = req.body;
    if (!revieweeId || !listingId || !rating) return next(createError('Missing required fields', 400));
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return next(createError('Rating must be an integer between 1 and 5', 400));
    }

    if (typeof revieweeId !== 'string' || typeof listingId !== 'string') return next(createError('Missing required fields', 400));
    if (comment != null && (typeof comment !== 'string' || comment.length > 1000)) {
      return next(createError('Comment must be text of at most 1000 characters', 400));
    }

    const reviewerId = req.user!.userId;
    if (reviewerId === revieweeId) return next(createError('You cannot review yourself', 400));

    // The listing must exist and belong to the person being reviewed — otherwise any
    // listing id could be attached to a review of anyone.
    const reviewedListing = await prisma.listing.findUnique({ where: { id: listingId }, select: { userId: true } });
    if (!reviewedListing || reviewedListing.userId !== revieweeId) {
      return next(createError('Listing not found for this seller', 404));
    }
    // One review per reviewer per listing (the schema has no unique constraint for this).
    const alreadyReviewed = await prisma.review.findFirst({ where: { reviewerId, revieweeId, listingId }, select: { id: true } });
    if (alreadyReviewed) return next(createError('You have already reviewed this seller for this listing', 409));

    // Only allow a review if the two users actually got in touch on Piitrade
    // (at least one message between them) — keeps drive-by reviews out.
    const hadContact = await prisma.message.findFirst({
      where: {
        OR: [
          { senderId: reviewerId, receiverId: revieweeId },
          { senderId: revieweeId, receiverId: reviewerId },
        ],
      },
      select: { id: true },
    });
    if (!hadContact) {
      return next(createError('You can only review users you have contacted through Piitrade messages', 403));
    }

    const review = await prisma.review.create({
      data: { reviewerId, revieweeId, listingId, rating: ratingNum, comment },
      include: { reviewer: { select: { id: true, name: true, avatar: true } } },
    });
    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
});

// ─── Product Reviews ──────────────────────────────────────────────────────────

/**
 * GET /api/reviews/recent
 * Public – returns recent approved reviews across all listings.
 */
router.get('/recent', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(50, parseInt(req.query.limit as string || '10'));
    const rawRating = req.query.rating ? parseInt(req.query.rating as string) : undefined;
    const ratingFilter = rawRating !== undefined && Number.isInteger(rawRating) && rawRating >= 1 && rawRating <= 5 ? rawRating : undefined;
    const sort = (req.query.sort as string) || 'recent';

    const orderBy =
      sort === 'highest' ? { rating: 'desc' as const } :
      sort === 'lowest'  ? { rating: 'asc' as const } :
      sort === 'helpful' ? { helpfulCount: 'desc' as const } :
      { createdAt: 'desc' as const };

    const where = {
      status: 'APPROVED' as const,
      ...(ratingFilter ? { rating: ratingFilter } : {}),
    };

    const [reviews, total] = await Promise.all([
      prisma.productReview.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, avatar: true } },
          listing: { select: { id: true, title: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.productReview.count({ where }),
    ]);

    res.json({
      reviews,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reviews/listing/:listingId
 * Public – returns approved reviews for a listing, with aggregated stats.
 */
router.get('/listing/:listingId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { listingId } = req.params;
    const sort = (req.query.sort as string) || 'recent';
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(50, parseInt(req.query.limit as string || '10'));

    const orderBy =
      sort === 'helpful' ? { helpfulCount: 'desc' as const } :
      sort === 'highest' ? { rating: 'desc' as const } :
      sort === 'lowest'  ? { rating: 'asc' as const } :
      { createdAt: 'desc' as const };

    const where = { listingId, status: 'APPROVED' as const };

    const [reviews, total, ratingAgg] = await Promise.all([
      prisma.productReview.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, avatar: true } },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.productReview.count({ where }),
      prisma.productReview.groupBy({
        by: ['rating'],
        where,
        _count: { rating: true },
      }),
    ]);

    // Build rating breakdown (1–5 star counts and percentages)
    const breakdown: Record<number, { count: number; pct: number }> = {};
    for (let s = 1; s <= 5; s++) {
      const row = ratingAgg.find((r) => r.rating === s);
      const count = row?._count.rating ?? 0;
      breakdown[s] = { count, pct: total > 0 ? Math.round((count / total) * 100) : 0 };
    }

    const totalRatingSum = ratingAgg.reduce((sum, r) => sum + r.rating * r._count.rating, 0);
    const averageRating = total > 0 ? Math.round((totalRatingSum / total) * 10) / 10 : 0;

    res.json({
      reviews,
      aggregate: { averageRating, total, breakdown },
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reviews/listing/:listingId
 * Authenticated – submit a product review. One review per user per listing.
 */
router.post('/listing/:listingId', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { listingId } = req.params;
    const userId = req.user!.userId;
    const { rating, title, content } = req.body;

    if (!rating || typeof content !== 'string' || !content) return next(createError('Rating and content are required', 400));
    if (title != null && typeof title !== 'string') return next(createError('Invalid review title', 400));
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return next(createError('Rating must be an integer between 1 and 5', 400));
    }
    if (content.length < 10) return next(createError('Review content must be at least 10 characters', 400));
    if (content.length > 2000) return next(createError('Review content must not exceed 2000 characters', 400));
    if (title && title.length > 150) return next(createError('Review title must not exceed 150 characters', 400));

    // Check listing exists
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) return next(createError('Listing not found', 404));

    // Prevent duplicate review
    const existing = await prisma.productReview.findUnique({
      where: { userId_listingId: { userId, listingId } },
    });
    if (existing) return next(createError('You have already reviewed this listing', 409));

    if (listing.userId === userId) return next(createError('You cannot review your own listing', 400));

    // Reviewer must have contacted the seller through Piitrade messages first.
    const hadContact = await prisma.message.findFirst({
      where: { senderId: userId, receiverId: listing.userId },
      select: { id: true },
    });
    if (!hadContact) {
      return next(createError('Message the seller first — only people who have contacted the seller can review this listing', 403));
    }

    const review = await prisma.productReview.create({
      data: {
        listingId,
        userId,
        rating: ratingNum,
        title: title || null,
        content,
        status: 'PENDING',
      },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });

    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reviews/:id/helpful
 * Authenticated – toggle helpful vote on a product review.
 */
router.post('/:id/helpful', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const reviewId = req.params.id;
    const userId = req.user!.userId;

    const review = await prisma.productReview.findUnique({ where: { id: reviewId } });
    if (!review) return next(createError('Review not found', 404));
    if (review.status !== 'APPROVED') return next(createError('Review is not published', 400));

    const existing = await prisma.helpfulVote.findUnique({
      where: { reviewId_userId: { reviewId, userId } },
    });

    if (existing) {
      // Remove vote
      await prisma.$transaction([
        prisma.helpfulVote.delete({ where: { reviewId_userId: { reviewId, userId } } }),
        prisma.productReview.update({
          where: { id: reviewId },
          data: { helpfulCount: { decrement: 1 } },
        }),
      ]);
      return res.json({ helpful: false });
    } else {
      // Add vote
      await prisma.$transaction([
        prisma.helpfulVote.create({ data: { reviewId, userId } }),
        prisma.productReview.update({
          where: { id: reviewId },
          data: { helpfulCount: { increment: 1 } },
        }),
      ]);
      return res.json({ helpful: true });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
