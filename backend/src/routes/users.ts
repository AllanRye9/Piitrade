import { normalizeUserPhone, phoneLookupCandidates } from '../utils/phone';
import { parseListingColumns } from '../utils/userPreferences';
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt';
import { setRefreshTokenCookie, clearRefreshTokenCookie } from '../utils/authCookies';
import { invalidateAccountStatus } from '../middleware/auth';
import { hashToken } from '../utils/tokenHash';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { buildCurrentUserSelect, hasUserPersonalIdColumn } from '../utils/userSchema';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { optionalString, optionalWebsite } from '../utils/inputGuards';

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
      socialLinks,
    } = req.body;
    // Plain strings only (no Prisma operator objects), and a website must be an http(s) URL.
    const companyName = optionalString(req.body.companyName, 'companyName');
    const registrationNumber = optionalString(req.body.registrationNumber, 'registrationNumber', 100);
    const agentLicense = optionalString(req.body.agentLicense, 'agentLicense', 100);
    const agentType = optionalString(req.body.agentType, 'agentType', 50);
    const website = optionalWebsite(req.body.website);
    const businessDescription = optionalString(req.body.businessDescription, 'businessDescription', 2000);
    const data: Record<string, unknown> = {};
    if (name) data.name = name;
    if (phone !== undefined) {
      const normalizedPhone = normalizeUserPhone(phone);
      if (normalizedPhone) {
        const taken = await prisma.user.findFirst({
          where: { phone: { in: phoneLookupCandidates(normalizedPhone) }, id: { not: req.user!.userId } },
          select: { id: true },
        });
        if (taken) throw createError('An account with this phone number already exists.', 409);
      }
      data.phone = normalizedPhone;
    }
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
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// PUT /api/users/me/password { currentPassword, newPassword }
// Proves the current password, sets the new one, ends every other session (the single stored refresh
// token is replaced) and hands this browser a fresh session so the user is not logged out.
router.put('/me/password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || currentPassword.length > MAX_PASSWORD_LENGTH) {
      return next(createError('Current and new password are required', 400));
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      return next(createError(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`, 400));
    }
    if (newPassword === currentPassword) return next(createError('Choose a password different from your current one', 400));

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { id: true, email: true, role: true, password: true } });
    if (!user) return next(createError('User not found', 404));
    if (!(await bcrypt.compare(currentPassword, user.password))) return next(createError('Current password is incorrect', 403));

    const refreshToken = generateRefreshToken({ userId: user.id, email: user.email, role: user.role });
    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(newPassword, 12), refreshToken: hashToken(refreshToken), passwordResetToken: null, passwordResetExpiry: null },
    });
    setRefreshTokenCookie(req, res, refreshToken);
    res.json({ message: 'Password updated. Other devices have been signed out.', accessToken: generateAccessToken({ userId: user.id, email: user.email, role: user.role }) });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/me/export — everything we hold about the caller, as a JSON download.
// Secrets (password hash, session/reset/verification tokens) are never included.
router.get('/me/export', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const includePersonalId = await hasUserPersonalIdColumn();
    const [profile, listings, payments, subscriptions, storeRentals] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: buildCurrentUserSelect(includePersonalId) }),
      prisma.listing.findMany({ where: { userId }, select: { id: true, title: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5000 }),
      prisma.paymentTransaction.findMany({ where: { userId }, select: { id: true, purpose: true, amount: true, currency: true, status: true, msisdn: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5000 }),
      prisma.sellerSubscription.findMany({ where: { userId }, select: { id: true, status: true, startDate: true, endDate: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1000 }),
      prisma.storeRental.findMany({ where: { userId }, select: { id: true, status: true, tier: true, startDate: true, endDate: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    ]);
    res.setHeader('Content-Disposition', 'attachment; filename="my-piitrade-data.json"');
    res.json({ exportedAt: new Date().toISOString(), profile, listings, payments, subscriptions, storeRentals });
  } catch (err) {
    next(err);
  }
});

// POST /api/users/me/delete { password, confirm: 'DELETE' }
// Self-service account closure. Rows other people's records point at (messages, reviews, payments)
// cannot simply be removed, so the account is ANONYMISED: personal data is wiped, the login is closed,
// and the user's listings are hidden. Financial records are kept, detached from any personal detail.
router.post('/me/delete', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { password, confirm } = req.body ?? {};
    if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH || confirm !== 'DELETE') {
      return next(createError('Enter your password and type DELETE to confirm', 400));
    }
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, password: true } });
    if (!user) return next(createError('User not found', 404));
    if (user.role === 'ADMIN') return next(createError('Admin accounts cannot be closed here. Ask another admin to change your role first.', 403));
    if (!(await bcrypt.compare(password, user.password))) return next(createError('Password is incorrect', 403));

    const now = new Date();
    const [openPayment, activeStore] = await Promise.all([
      prisma.paymentTransaction.findFirst({ where: { userId, status: { in: ['PENDING', 'NEEDS_REVIEW'] } }, select: { id: true } }),
      prisma.storeRental.findFirst({ where: { userId, status: { in: ['PENDING', 'ACTIVE'] }, endDate: { gt: now } }, select: { id: true } }),
    ]);
    if (openPayment) return next(createError('You have a payment still being processed. Please wait for it to finish before closing your account.', 409));
    if (activeStore) return next(createError('You have an active or pending Merchant account. Contact support to close it before deleting your account.', 409));

    const gone = `deleted-${userId}`;
    await prisma.$transaction([
      prisma.listing.updateMany({ where: { userId }, data: { status: 'HIDDEN', placement: 'NONE', placementExpiresAt: null } }),
      prisma.sellerSubscription.updateMany({ where: { userId, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } }, data: { status: 'CANCELLED' } }),
      prisma.user.update({
        where: { id: userId },
        data: {
          email: `${gone}@deleted.invalid`, name: 'Deleted user', phone: null, avatar: null,
          password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
          isBanned: true, isVerified: false,
          refreshToken: null, passwordResetToken: null, passwordResetExpiry: null,
          emailVerificationToken: null, emailVerificationExpiry: null,
          companyName: null, registrationNumber: null, agentLicense: null, agentType: null, website: null,
          businessDescription: null, socialLinks: Prisma.DbNull, cvThemeColor: null,
          kycDocumentUrl: null, kycDocumentBackUrl: null, kycSelfieUrl: null, kycFullName: null, kycPurpose: null,
          kycBusinessName: null, kycBusinessRegNumber: null, kycPhone: null, kycAddress: null,
          kycDraftFullName: null, kycDraftDocumentUrl: null, kycDraftDocumentBackUrl: null, kycDraftSelfieUrl: null,
        },
      }),
    ]);
    invalidateAccountStatus(userId);
    clearRefreshTokenCookie(req, res);
    logger.info(`Account ${userId} closed by its owner (anonymised)`);
    res.json({ message: 'Your account has been closed and your personal details removed.' });
  } catch (err) {
    next(err);
  }
});

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
        // Never hand out storage URLs here; CVs are shared only through job applications, and a
        // public non-CV document is opened via GET /upload/documents/:id/file.
        documents: {
          where: { isPublic: true, type: { not: 'CV' } },
          select: { id: true, type: true, title: true, description: true, createdAt: true },
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
