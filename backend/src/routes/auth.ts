import { getGeneralSettings } from '../utils/siteSettings';
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../utils/prisma';
import { Prisma } from '@prisma/client';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { packageSnapshot } from '../utils/subscriptionService';
import { sendEmailVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } from '../utils/email';
import { buildAuthenticatedUserSelect, buildAuthResponseUserSelect, hasUserPersonalIdColumn } from '../utils/userSchema';
import { setRefreshTokenCookie, clearRefreshTokenCookie, getRefreshTokenCookie } from '../utils/authCookies';
import { rememberRotatedRefresh, getRotatedRefresh } from '../utils/refreshGrace';
import { normalizeEmailInput, emailLookupCandidates } from '../utils/emailNormalize';
import { requireTrustedOrigin } from '../middleware/originCheck';
import { invalidateAccountStatus } from '../middleware/auth';

// Compared against when no account matches, so "unknown email" and "wrong
// password" take the same time (no account enumeration via response timing).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('piitrade-timing-equaliser', 12);

const MAX_PASSWORD_LENGTH = 128;
const MIN_PASSWORD_LENGTH = 8;

/** Constant-time string comparison (avoids leaking the secret via timing). */
function safeEqual(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Derives a short, human-readable personal ID from a UUID. Format: PIT-XXXXXXXX */
function generatePersonalId(uuid: string): string {
  return 'PIT-' + uuid.substring(0, 8).toUpperCase();
}

const router = Router();

function isPrismaUniqueError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function getDuplicateAccountMessage(err: Prisma.PrismaClientKnownRequestError): string {
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [];

  if (fields.includes('email')) {
    return 'An account with this email already exists.';
  }

  if (fields.includes('phone')) {
    return 'An account with this phone number already exists.';
  }

  if (fields.includes('registrationNumber')) {
    return 'An account with this registration number already exists.';
  }

  if (fields.includes('agentLicense')) {
    return 'An account with this agent license already exists.';
  }

  if (fields.includes('personalId')) {
    return 'Unable to create account due to an internal ID conflict. Please try again.';
  }

  return 'An account with this information already exists.';
}

function isValidEmailAddress(email: string): boolean {
  if (!email || email.length > 254) return false;
  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false;
  const domain = email.slice(atIndex + 1);
  if (!domain || domain.startsWith('.') || domain.endsWith('.')) return false;
  return domain.includes('.');
}

const registerValidation = [
  // Stored exactly as typed (trimmed + lower-cased) so it matches what /login
  // looks up. express-validator's normalizeEmail() used to strip Gmail dots, which
  // made those accounts impossible to sign into — see utils/emailNormalize.ts.
  body('email').trim().isEmail().isLength({ max: 254 }).customSanitizer(normalizeEmailInput),
  body('password').isString().isLength({ min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH })
    .withMessage(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`),
  body('name').isString().trim().notEmpty().isLength({ max: 120 }),
  body('phone').optional({ values: 'falsy' }).isString().isLength({ max: 40 }),
  body('country').isIn(['UGANDA']),
  body('role').optional().isIn(['BUYER', 'SELLER', 'AGENT', 'ORGANIZATION', 'COMPANY']),
];

router.post('/register', registerValidation, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Admin → Settings → Allow Registration
    if (!(await getGeneralSettings()).allowRegistration) {
      res.status(403).json({ message: 'New account registration is temporarily closed. Please check back later.', registrationClosed: true });
      return;
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, password, name, phone, country, role, companyName, registrationNumber, agentLicense, agentType, website, businessDescription } = req.body;
    const includePersonalId = await hasUserPersonalIdColumn();

    const emailCandidates = emailLookupCandidates(email);
    const duplicateChecks: Prisma.UserWhereInput[] = [{ email: { in: emailCandidates } }];
    if (phone) duplicateChecks.push({ phone });
    if (registrationNumber) duplicateChecks.push({ registrationNumber });
    if (agentLicense) duplicateChecks.push({ agentLicense });

    const existing = await prisma.user.findFirst({
      where: { OR: duplicateChecks },
      select: {
        id: true,
        email: true,
        phone: true,
        registrationNumber: true,
        agentLicense: true,
      },
    });

    if (existing) {
      if (emailCandidates.includes(existing.email)) {
        return next(createError('An account with this email already exists.', 409));
      }
      if (phone && existing.phone === phone) {
        return next(createError('An account with this phone number already exists.', 409));
      }
      if (registrationNumber && existing.registrationNumber === registrationNumber) {
        return next(createError('An account with this registration number already exists.', 409));
      }
      if (agentLicense && existing.agentLicense === agentLicense) {
        return next(createError('An account with this agent license already exists.', 409));
      }

      return next(createError('An account with this information already exists.', 409));
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newId = uuidv4();
    const data: Record<string, unknown> = {
      id: newId,
      email,
      password: hashedPassword,
      name,
      phone,
      country,
      role: role || 'BUYER',
    };

    // Store extended profile fields when provided
    if (companyName) data.companyName = companyName;
    if (registrationNumber) data.registrationNumber = registrationNumber;
    if (agentLicense) data.agentLicense = agentLicense;
    if (agentType) data.agentType = agentType;
    if (website) data.website = website;
    if (businessDescription) data.businessDescription = businessDescription;

    if (includePersonalId) {
      data.personalId = generatePersonalId(newId);
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    let user;
    try {
      user = await prisma.user.create({
        data: data as Prisma.UserCreateInput,
        select: buildAuthResponseUserSelect(includePersonalId),
      });
    } catch (err) {
      if (isPrismaUniqueError(err)) {
        return next(createError(getDuplicateAccountMessage(err), 409));
      }
      throw err;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
          emailVerificationToken: verificationToken,
          emailVerificationExpiry: verificationExpiry,
      },
    });

    try {
      await sendEmailVerificationEmail(user.email, user.name, verificationToken);
    } catch (err) {
      logger.error(`Verification email failed for ${user.email}: ${String(err)}`);
      await prisma.user.delete({ where: { id: user.id } }).catch((cleanupErr) =>
        logger.error(`Failed to rollback user after verification email error: ${String(cleanupErr)}`)
      );
      return next(createError('Unable to send verification email right now. Please try again shortly.', 503));
    }

    // ── Auto-create free trial subscription for ordinary users ────────────────
    // Admin accounts get all privileges by default and don't need a trial.
    if (data && typeof data === 'object' && (data as Record<string, unknown>).role !== 'ADMIN') {
      try {
        // Read trial period from admin general settings (default 7 days)
        const siteConfig = await prisma.siteConfig.findUnique({ where: { id: 'global' } });
        const generalSettings = (siteConfig?.generalSettings as Record<string, unknown>) ?? {};
        const trialDays = typeof generalSettings.trialDays === 'number' ? generalSettings.trialDays : 7;

        if (trialDays > 0) {
          // Find or create the free trial package (isFree = true, durationDays = trialDays)
          let trialPackage = await prisma.sellerPackage.findFirst({
            where: { isFree: true, isActive: true, scope: 'LISTING' },
          });
          if (!trialPackage) {
            trialPackage = await prisma.sellerPackage.create({
              data: {
                name: `Free Trial (${trialDays} days)`,
                description: 'Automatically created free trial for new users',
                isFree: true,
                price: 0,
                currency: 'UGX',
                durationDays: trialDays,
                maxListings: null, // unlimited during trial
                isActive: true,
                scope: 'LISTING',
              },
            });
          }
          const now = new Date();
          const endDate = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
          await prisma.sellerSubscription.create({
            data: {
              userId: user.id,
              packageId: trialPackage.id,
              status: 'ACTIVE',
              startDate: now,
              endDate,
              approvedAt: now,
              // Frozen with the length the user is actually given (admin setting), not whatever
              // the shared trial package happens to say.
              ...packageSnapshot({ ...trialPackage, durationDays: trialDays }, now),
            },
          });
          logger.info(`Trial subscription created for new user ${user.id} — expires ${endDate.toISOString()}`);
        }
      } catch (trialErr) {
        // Non-fatal: log but don't block registration
        logger.warn(`Failed to create trial subscription for user ${user.id}: ${String(trialErr)}`);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    res.status(201).json({
      message: 'Registration successful. Please verify your email before logging in.',
      user,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const email = normalizeEmailInput(rawEmail);
    if (!email || !password) {
      return next(createError('Email and password required', 400));
    }
    if (!isValidEmailAddress(email) || password.length > MAX_PASSWORD_LENGTH) {
      return next(createError('Invalid credentials', 401));
    }

    const includePersonalId = await hasUserPersonalIdColumn();
    // Exact address first; the legacy-normalised form only as a fallback so
    // accounts created under the old Gmail-dot-stripping behaviour still work.
    const matches = await prisma.user.findMany({
      where: { email: { in: emailLookupCandidates(email) } },
      select: buildAuthenticatedUserSelect(includePersonalId),
      take: 3,
    });
    const user = matches.find((u) => u.email === email) ?? matches[0] ?? null;

    // Always run one bcrypt comparison so timing doesn't reveal whether the account exists.
    const valid = await bcrypt.compare(password, user ? user.password : DUMMY_PASSWORD_HASH);
    if (!user || !valid) return next(createError('Invalid credentials', 401));
    // Checked only AFTER the password is proven, so ban status isn't disclosed to
    // someone who merely knows an email address.
    if (user.isBanned) return next(createError('Account is banned', 403));

    // Email verification gate: an unverified account must not receive a
    // session, even though the password check above already succeeded.
    // Admins are exempted — those accounts are provisioned by trusted staff
    // (see prisma/seed.ts) rather than through public self-registration, and
    // gating them risks locking out existing production admin accounts
    // whose isVerified flag was never backfilled. /auth/resend-verification
    // (unchanged) lets a regular user request a fresh link if theirs expired.
    if (!user.isVerified && user.role !== 'ADMIN') {
      return next(createError('Please verify your email before signing in. Check your inbox for the verification link, or request a new one.', 403));
    }

    const accessToken = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id, email: user.email, role: user.role });

    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    // The refresh token now lives only in an httpOnly cookie — it's never
    // put in the JSON body, so frontend JS (and anything that can run JS on
    // the page via XSS) never has access to it.
    setRefreshTokenCookie(req, res, refreshToken);

    const { password: _, refreshToken: __, ...userData } = user;
    res.json({ user: userData, accessToken });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;
    // Must be a plain string: Prisma treats an object such as {"not": ""} as a
    // filter, which would match ANY pending account instead of the one owning the token.
    if (typeof token !== 'string' || token.length < 16 || token.length > 256) {
      return next(createError('Verification token is required', 400));
    }

    const user = await prisma.user.findFirst({
      where: {
          emailVerificationToken: token,
          emailVerificationExpiry: { gt: new Date() },
      },
      select: { id: true, email: true, name: true, isVerified: true },
    });

    if (!user) {
      return next(createError('Verification token is invalid or has expired', 400));
    }

    if (!user.isVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiry: null,
        },
      });

      sendWelcomeEmail(user.email, user.name).catch((err) =>
        logger.error(`Welcome email failed for ${user.email}: ${String(err)}`)
      );
    }

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
});

router.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = normalizeEmailInput(req.body?.email);
    if (!email) {
      return next(createError('Email is required', 400));
    }

    const found = await prisma.user.findMany({
      where: { email: { in: emailLookupCandidates(email) } },
      select: { id: true, email: true, name: true, isVerified: true },
      take: 3,
    });
    const user = found.find((u) => u.email === email) ?? found[0] ?? null;

    // Always return a generic response to avoid account enumeration.
    if (!user || user.isVerified) {
      res.json({ message: 'If the account exists and is unverified, a verification email has been sent.' });
      return;
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
          emailVerificationToken: verificationToken,
          emailVerificationExpiry: verificationExpiry,
      },
    });

    try {
      await sendEmailVerificationEmail(user.email, user.name, verificationToken);
    } catch (err) {
      logger.error(`Verification email resend failed for ${user.email}: ${String(err)}`);
      return next(createError('Unable to send verification email right now. Please try again shortly.', 503));
    }

    res.json({ message: 'If the account exists and is unverified, a verification email has been sent.' });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', requireTrustedOrigin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Read the refresh token from the httpOnly cookie rather than the
    // request body — it's never exposed to frontend JS in the first place.
    const refreshToken = getRefreshTokenCookie(req);
    if (!refreshToken) return next(createError('Refresh token required', 400));

    // If this exact token was already rotated away moments ago — most
    // likely a second browser tab's request racing another tab's, both
    // firing around the same access-token expiry — replay the same result
    // instead of rejecting it. See utils/refreshGrace.ts for why this
    // matters.
    const replay = getRotatedRefresh(refreshToken);
    if (replay) {
      setRefreshTokenCookie(req, res, replay.refreshToken);
      res.json({ accessToken: replay.accessToken });
      return;
    }

    const payload = verifyRefreshToken(refreshToken);
    const includePersonalId = await hasUserPersonalIdColumn();
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: buildAuthenticatedUserSelect(includePersonalId) });

    if (!user || user.refreshToken !== refreshToken) {
      // Someone else's request may have won a race and rotated this exact
      // token in the moment between our read above and getting here (two
      // requests can both pass this point before either has committed its
      // write) — check the grace map once more before giving up, since the
      // winner's rotation may have landed while we were mid-flight.
      const replayAfterRace = getRotatedRefresh(refreshToken);
      if (replayAfterRace) {
        setRefreshTokenCookie(req, res, replayAfterRace.refreshToken);
        res.json({ accessToken: replayAfterRace.accessToken });
        return;
      }
      clearRefreshTokenCookie(req, res);
      return next(createError('Invalid refresh token', 401));
    }

    // A banned account must not be able to keep minting fresh access tokens.
    if (user.isBanned) {
      await prisma.user.update({ where: { id: user.id }, data: { refreshToken: null } }).catch(() => undefined);
      invalidateAccountStatus(user.id);
      clearRefreshTokenCookie(req, res);
      return next(createError('Account is banned', 403));
    }

    const accessToken = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    const newRefreshToken = generateRefreshToken({ userId: user.id, email: user.email, role: user.role });

    // Atomic compare-and-swap: only commit the rotation if `refreshToken` is
    // STILL the current value in the database (i.e. no one else's request
    // has already rotated it since we read it above). A plain
    // findUnique-then-update has a window where two concurrent requests can
    // both pass the check above before either has written — this update's
    // WHERE clause is evaluated atomically by the database, so only one of
    // two racing requests can ever actually win it.
    const rotated = await prisma.user.updateMany({
      where: { id: user.id, refreshToken },
      data: { refreshToken: newRefreshToken },
    });

    if (rotated.count === 0) {
      // Lost the race — another request rotated this token first. Its
      // result should already be sitting in the grace map by now.
      const replayAfterRace = getRotatedRefresh(refreshToken);
      if (replayAfterRace) {
        setRefreshTokenCookie(req, res, replayAfterRace.refreshToken);
        res.json({ accessToken: replayAfterRace.accessToken });
        return;
      }
      clearRefreshTokenCookie(req, res);
      return next(createError('Invalid refresh token', 401));
    }

    rememberRotatedRefresh(refreshToken, accessToken, newRefreshToken);

    setRefreshTokenCookie(req, res, newRefreshToken);
    res.json({ accessToken });
  } catch {
    logger.error('Refresh token verification failed');
    clearRefreshTokenCookie(req, res);
    next(createError('Invalid refresh token', 401));
  }
});

router.post('/logout', requireTrustedOrigin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Try to revoke refresh token if present; ignore auth errors so expired
    // tokens don't block users from logging out.
    const refreshToken = getRefreshTokenCookie(req);
    if (refreshToken) {
      try {
        const payload = verifyRefreshToken(refreshToken);
        await prisma.user.update({
          where: { id: payload.userId },
          data: { refreshToken: null },
        });
      } catch {
        // Token is invalid/expired – still return success so client clears local storage
      }
    }
    clearRefreshTokenCookie(req, res);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// Self-service admin creation is a standing back door: anyone who learns (or
// guesses) ADMIN_SECRET becomes an administrator. In production it is therefore
// OFF unless an operator deliberately sets ENABLE_ADMIN_REGISTER=true — and
// should be switched off again once the first admin exists (or use prisma seed).
const MIN_ADMIN_PASSWORD_LENGTH = 12;
const MAX_ADMINS = 3; // same cap as PUT /admin/users/:id

router.post('/admin-register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_ADMIN_REGISTER !== 'true') {
      res.status(404).json({ message: 'Not found' });
      return;
    }

    const { password, name, adminSecret } = req.body ?? {};
    const email = normalizeEmailInput(req.body?.email);

    const expectedSecret = process.env.ADMIN_SECRET;
    if (!expectedSecret || !safeEqual(adminSecret, expectedSecret)) {
      return next(createError('Invalid admin secret', 403));
    }

    if (!email || typeof password !== 'string' || typeof name !== 'string' || !name.trim()) {
      return next(createError('Email, password, and name are required', 400));
    }
    if (!isValidEmailAddress(email)) {
      return next(createError('Please provide a valid email address', 400));
    }
    if (password.length < MIN_ADMIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return next(createError(`Password must be ${MIN_ADMIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`, 400));
    }

    if ((await prisma.user.count({ where: { role: 'ADMIN' } })) >= MAX_ADMINS) {
      return next(createError(`Maximum admin limit reached (${MAX_ADMINS})`, 400));
    }

    const includePersonalId = await hasUserPersonalIdColumn();
    const existing = await prisma.user.findFirst({ where: { email: { in: emailLookupCandidates(email) } }, select: { id: true } });
    if (existing) {
      return next(createError('An account with this email already exists.', 409));
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newId = uuidv4();
    const data: Record<string, unknown> = {
      id: newId,
      email,
      password: hashedPassword,
      name: name.trim(),
      role: 'ADMIN',
      country: 'UGANDA', // Uganda-only marketplace; never trust a client-supplied value here
      isVerified: true,
    };

    if (includePersonalId) {
      data.personalId = generatePersonalId(newId);
    }

    let user;
    try {
      user = await prisma.user.create({
        data: data as Prisma.UserCreateInput,
        select: buildAuthResponseUserSelect(includePersonalId),
      });
    } catch (err) {
      if (isPrismaUniqueError(err)) {
        return next(createError(getDuplicateAccountMessage(err), 409));
      }
      throw err;
    }

    const accessToken = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id, email: user.email, role: user.role });

    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    setRefreshTokenCookie(req, res, refreshToken);
    res.status(201).json({ user, accessToken });
  } catch (err) {
    next(err);
  }
});

// Forgot password — sends reset link via email
router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
    const email = normalizeEmailInput(rawEmail);
    if (!email) return next(createError('Email is required', 400));

    if (!isValidEmailAddress(email)) return next(createError('Please provide a valid email address', 400));

    const found = await prisma.user.findMany({
      where: { email: { in: emailLookupCandidates(email) } },
      select: { id: true, email: true, name: true },
      take: 3,
    });
    const user = found.find((u) => u.email === email) ?? found[0] ?? null;

    // Explicitly check if email exists — return a clear message either way.
    // We do NOT reveal whether an account exists to prevent email enumeration,
    // but we only send the reset email when the user genuinely exists.
    if (!user) {
      res.json({ message: 'If that email is registered you will receive a reset link shortly.' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: resetToken, passwordResetExpiry: resetExpiry },
    });

    try {
      await sendPasswordResetEmail(user.email, user.name, resetToken);
    } catch (err) {
      logger.error(`Password reset email failed for user ${user.id}: ${String(err)}`);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: null, passwordResetExpiry: null },
      }).catch((cleanupErr) =>
        logger.error(`Failed to rollback password reset token for user ${user.id}: ${String(cleanupErr)}`)
      );
      return next(createError('Unable to send password reset email right now. Please try again shortly.', 503));
    }

    res.json({ message: 'If that email is registered you will receive a reset link shortly.' });
  } catch (err) {
    next(err);
  }
});

// Reset password — validates token and sets new password
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, password } = req.body ?? {};
    // Both MUST be plain strings. `token` goes into a Prisma `where`; if it were an
    // object like {"not": ""} Prisma would read it as a filter and match whichever
    // account currently has a pending reset — letting an attacker set ITS password.
    if (typeof token !== 'string' || typeof password !== 'string' || token.length < 16 || token.length > 256) {
      return next(createError('Token and new password are required', 400));
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return next(createError(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`, 400));
    }

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!user) return next(createError('Reset token is invalid or has expired', 400));

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiry: null,
        refreshToken: null, // invalidate existing sessions
      },
    });
    invalidateAccountStatus(user.id);

    res.json({ message: 'Password updated successfully. You can now sign in.' });
  } catch (err) {
    next(err);
  }
});

export default router;
