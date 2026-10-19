import { parseListingColumns } from '../utils/userPreferences';
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { buildCurrentUserSelect, hasUserPersonalIdColumn } from '../utils/userSchema';
import { logger } from '../utils/logger';

const router = Router();

router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const includePersonalId = await hasUserPersonalIdColumn();
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: buildCurrentUserSelect(includePersonalId),
    });
    if (!user) return next(createError('User not found', 404));
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.put('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const includePersonalId = await hasUserPersonalIdColumn();
    const {
      name, phone, avatar, country, cvThemeColor,
      companyName, registrationNumber, agentLicense, agentType, website, businessDescription, socialLinks,
    } = req.body;
    const data: Record<string, unknown> = {};
    if (name) data.name = name;
    if (phone !== undefined) data.phone = phone === '' ? null : phone;
    if (country) data.country = country;
    if (avatar !== undefined) data.avatar = avatar === '' ? null : avatar;
    if (cvThemeColor !== undefined) data.cvThemeColor = cvThemeColor === '' ? null : cvThemeColor;
    if (companyName !== undefined) data.companyName = companyName === '' ? null : companyName;
    if (registrationNumber !== undefined) data.registrationNumber = registrationNumber === '' ? null : registrationNumber;
    if (agentLicense !== undefined) data.agentLicense = agentLicense === '' ? null : agentLicense;
    if (agentType !== undefined) data.agentType = agentType === '' ? null : agentType;
    if (website !== undefined) data.website = website === '' ? null : website;
    if (businessDescription !== undefined) data.businessDescription = businessDescription === '' ? null : businessDescription;
    if (socialLinks !== undefined) data.socialLinks = socialLinks;
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data,
      select: buildCurrentUserSelect(includePersonalId),
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ─── Display preferences ──────────────────────────────────────────────────────
// GET /api/users/me/preferences -> { preferences: { listingColumns: number | null } }
// PUT /api/users/me/preferences { listingColumns: 1-6 | null } -> same shape.
// `listingColumns` is the number of listing cards per row the user chose on /profile/listings;
// null means "use the site default". Also returned on /auth/me and login as `listingColumns`, so a
// page can render correctly on first paint without an extra request. (Registered before any
// `/:id` route so "me" is never mistaken for a user id.)
router.get('/me/preferences', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const row = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { listingColumns: true } });
    if (!row) return next(createError('User not found', 404));
    res.set('Cache-Control', 'private, no-store');
    res.json({ preferences: { listingColumns: row.listingColumns } });
  } catch (err) {
    next(err);
  }
});

router.put('/me/preferences', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!('listingColumns' in body)) return next(createError('Nothing to update', 400));
    const parsed = parseListingColumns(body.listingColumns);
    if (parsed.ok === false) return next(createError(parsed.message, 400));
    const row = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { listingColumns: parsed.value },
      select: { listingColumns: true },
    });
    res.json({ preferences: { listingColumns: row.listingColumns } });
  } catch (err) {
    next(err);
  }
});

router.get('/favorites', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user!.userId },
      include: {
        listing: {
          include: { category: true, user: { select: { id: true, name: true, avatar: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Separate valid from stale favorites
    const staleIds: string[] = [];
    const activeListings: NonNullable<typeof favorites[0]['listing']>[] = [];

    for (const f of favorites) {
      const listing = f.listing;
      const isAvailable =
        listing !== null &&
        listing.status === 'ACTIVE' &&
        (listing.expiresAt === null || listing.expiresAt > now);

      if (isAvailable) {
        activeListings.push(listing);
      } else {
        staleIds.push(f.id);
      }
    }

    // Clean up stale favorites in the background (don't await to avoid slowing the response)
    if (staleIds.length > 0) {
      void prisma.favorite
        .deleteMany({ where: { id: { in: staleIds } } })
        .catch((err) => logger.warn(`Failed to clean up stale favorites: ${String(err)}`));
    }

    res.json(activeListings);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/reviews', async (req, res: Response, next: NextFunction) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { revieweeId: req.params.id },
      include: { reviewer: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reviews);
  } catch (err) {
    next(err);
  }
});

// GET /users/candidate/:id — authenticated CV profile for the job market
router.get('/candidate/:id', authenticate, async (req, res: Response, next: NextFunction) => {
  try {
    const candidate = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        avatar: true,
        country: true,
        cvThemeColor: true,
        createdAt: true,
        documents: {
          where: { isPublic: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!candidate) return next(createError('Candidate not found', 404));
    // Only return candidates who have at least one public document
    if (candidate.documents.length === 0) return next(createError('Candidate not found', 404));
    res.json({ candidate });
  } catch (err) {
    next(err);
  }
});

export default router;
