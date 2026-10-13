"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const siteSettings_1 = require("../utils/siteSettings");
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const uuid_1 = require("uuid");
const prisma_1 = require("../utils/prisma");
const client_1 = require("@prisma/client");
const jwt_1 = require("../utils/jwt");
const errorHandler_1 = require("../middleware/errorHandler");
const logger_1 = require("../utils/logger");
const email_1 = require("../utils/email");
const userSchema_1 = require("../utils/userSchema");
const authCookies_1 = require("../utils/authCookies");
const refreshGrace_1 = require("../utils/refreshGrace");
/** Derives a short, human-readable personal ID from a UUID. Format: PIT-XXXXXXXX */
function generatePersonalId(uuid) {
    return 'PIT-' + uuid.substring(0, 8).toUpperCase();
}
const router = (0, express_1.Router)();
function isPrismaUniqueError(err) {
    return err instanceof client_1.Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
function getDuplicateAccountMessage(err) {
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
function isValidEmailAddress(email) {
    if (!email || email.length > 254)
        return false;
    const atIndex = email.indexOf('@');
    if (atIndex <= 0 || atIndex !== email.lastIndexOf('@'))
        return false;
    const domain = email.slice(atIndex + 1);
    if (!domain || domain.startsWith('.') || domain.endsWith('.'))
        return false;
    return domain.includes('.');
}
const registerValidation = [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('password').isLength({ min: 6 }),
    (0, express_validator_1.body)('name').trim().notEmpty(),
    (0, express_validator_1.body)('country').isIn(['UGANDA']),
    (0, express_validator_1.body)('role').optional().isIn(['BUYER', 'SELLER', 'AGENT', 'ORGANIZATION', 'COMPANY']),
];
router.post('/register', registerValidation, async (req, res, next) => {
    try {
        // Admin → Settings → Allow Registration
        if (!(await (0, siteSettings_1.getGeneralSettings)()).allowRegistration) {
            res.status(403).json({ message: 'New account registration is temporarily closed. Please check back later.', registrationClosed: true });
            return;
        }
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { email, password, name, phone, country, role, companyName, registrationNumber, agentLicense, agentType, website, businessDescription } = req.body;
        const includePersonalId = await (0, userSchema_1.hasUserPersonalIdColumn)();
        const duplicateChecks = [{ email }];
        if (phone)
            duplicateChecks.push({ phone });
        if (registrationNumber)
            duplicateChecks.push({ registrationNumber });
        if (agentLicense)
            duplicateChecks.push({ agentLicense });
        const existing = await prisma_1.prisma.user.findFirst({
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
            if (existing.email === email) {
                return next((0, errorHandler_1.createError)('An account with this email already exists.', 409));
            }
            if (phone && existing.phone === phone) {
                return next((0, errorHandler_1.createError)('An account with this phone number already exists.', 409));
            }
            if (registrationNumber && existing.registrationNumber === registrationNumber) {
                return next((0, errorHandler_1.createError)('An account with this registration number already exists.', 409));
            }
            if (agentLicense && existing.agentLicense === agentLicense) {
                return next((0, errorHandler_1.createError)('An account with this agent license already exists.', 409));
            }
            return next((0, errorHandler_1.createError)('An account with this information already exists.', 409));
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 12);
        const newId = (0, uuid_1.v4)();
        const data = {
            id: newId,
            email,
            password: hashedPassword,
            name,
            phone,
            country,
            role: role || 'BUYER',
        };
        // Store extended profile fields when provided
        if (companyName)
            data.companyName = companyName;
        if (registrationNumber)
            data.registrationNumber = registrationNumber;
        if (agentLicense)
            data.agentLicense = agentLicense;
        if (agentType)
            data.agentType = agentType;
        if (website)
            data.website = website;
        if (businessDescription)
            data.businessDescription = businessDescription;
        if (includePersonalId) {
            data.personalId = generatePersonalId(newId);
        }
        const verificationToken = crypto_1.default.randomBytes(32).toString('hex');
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        let user;
        try {
            user = await prisma_1.prisma.user.create({
                data: data,
                select: (0, userSchema_1.buildAuthResponseUserSelect)(includePersonalId),
            });
        }
        catch (err) {
            if (isPrismaUniqueError(err)) {
                return next((0, errorHandler_1.createError)(getDuplicateAccountMessage(err), 409));
            }
            throw err;
        }
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerificationToken: verificationToken,
                emailVerificationExpiry: verificationExpiry,
            },
        });
        try {
            await (0, email_1.sendEmailVerificationEmail)(user.email, user.name, verificationToken);
        }
        catch (err) {
            logger_1.logger.error(`Verification email failed for ${user.email}: ${String(err)}`);
            await prisma_1.prisma.user.delete({ where: { id: user.id } }).catch((cleanupErr) => logger_1.logger.error(`Failed to rollback user after verification email error: ${String(cleanupErr)}`));
            return next((0, errorHandler_1.createError)('Unable to send verification email right now. Please try again shortly.', 503));
        }
        // ── Auto-create free trial subscription for ordinary users ────────────────
        // Admin accounts get all privileges by default and don't need a trial.
        if (data && typeof data === 'object' && data.role !== 'ADMIN') {
            try {
                // Read trial period from admin general settings (default 7 days)
                const siteConfig = await prisma_1.prisma.siteConfig.findUnique({ where: { id: 'global' } });
                const generalSettings = siteConfig?.generalSettings ?? {};
                const trialDays = typeof generalSettings.trialDays === 'number' ? generalSettings.trialDays : 7;
                if (trialDays > 0) {
                    // Find or create the free trial package (isFree = true, durationDays = trialDays)
                    let trialPackage = await prisma_1.prisma.sellerPackage.findFirst({
                        where: { isFree: true, isActive: true, scope: 'LISTING' },
                    });
                    if (!trialPackage) {
                        trialPackage = await prisma_1.prisma.sellerPackage.create({
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
                    await prisma_1.prisma.sellerSubscription.create({
                        data: {
                            userId: user.id,
                            packageId: trialPackage.id,
                            status: 'ACTIVE',
                            startDate: now,
                            endDate,
                        },
                    });
                    logger_1.logger.info(`Trial subscription created for new user ${user.id} — expires ${endDate.toISOString()}`);
                }
            }
            catch (trialErr) {
                // Non-fatal: log but don't block registration
                logger_1.logger.warn(`Failed to create trial subscription for user ${user.id}: ${String(trialErr)}`);
            }
        }
        // ─────────────────────────────────────────────────────────────────────────
        res.status(201).json({
            message: 'Registration successful. Please verify your email before logging in.',
            user,
        });
    }
    catch (err) {
        next(err);
    }
});
router.post('/login', async (req, res, next) => {
    try {
        const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const email = rawEmail.trim().toLowerCase();
        if (!email || !password) {
            return next((0, errorHandler_1.createError)('Email and password required', 400));
        }
        if (!isValidEmailAddress(email)) {
            return next((0, errorHandler_1.createError)('Please provide a valid email address', 400));
        }
        const includePersonalId = await (0, userSchema_1.hasUserPersonalIdColumn)();
        const user = await prisma_1.prisma.user.findUnique({ where: { email }, select: (0, userSchema_1.buildAuthenticatedUserSelect)(includePersonalId) });
        if (!user)
            return next((0, errorHandler_1.createError)('Invalid credentials', 401));
        if (user.isBanned)
            return next((0, errorHandler_1.createError)('Account is banned', 403));
        const valid = await bcryptjs_1.default.compare(password, user.password);
        if (!valid)
            return next((0, errorHandler_1.createError)('Invalid credentials', 401));
        // Email verification gate: an unverified account must not receive a
        // session, even though the password check above already succeeded.
        // Admins are exempted — those accounts are provisioned by trusted staff
        // (see prisma/seed.ts) rather than through public self-registration, and
        // gating them risks locking out existing production admin accounts
        // whose isVerified flag was never backfilled. /auth/resend-verification
        // (unchanged) lets a regular user request a fresh link if theirs expired.
        if (!user.isVerified && user.role !== 'ADMIN') {
            return next((0, errorHandler_1.createError)('Please verify your email before signing in. Check your inbox for the verification link, or request a new one.', 403));
        }
        const accessToken = (0, jwt_1.generateAccessToken)({ userId: user.id, email: user.email, role: user.role });
        const refreshToken = (0, jwt_1.generateRefreshToken)({ userId: user.id, email: user.email, role: user.role });
        await prisma_1.prisma.user.update({ where: { id: user.id }, data: { refreshToken } });
        // The refresh token now lives only in an httpOnly cookie — it's never
        // put in the JSON body, so frontend JS (and anything that can run JS on
        // the page via XSS) never has access to it.
        (0, authCookies_1.setRefreshTokenCookie)(req, res, refreshToken);
        const { password: _, refreshToken: __, ...userData } = user;
        res.json({ user: userData, accessToken });
    }
    catch (err) {
        next(err);
    }
});
router.post('/verify-email', async (req, res, next) => {
    try {
        const { token } = req.body;
        if (!token) {
            return next((0, errorHandler_1.createError)('Verification token is required', 400));
        }
        const user = await prisma_1.prisma.user.findFirst({
            where: {
                emailVerificationToken: token,
                emailVerificationExpiry: { gt: new Date() },
            },
            select: { id: true, email: true, name: true, isVerified: true },
        });
        if (!user) {
            return next((0, errorHandler_1.createError)('Verification token is invalid or has expired', 400));
        }
        if (!user.isVerified) {
            await prisma_1.prisma.user.update({
                where: { id: user.id },
                data: {
                    isVerified: true,
                    emailVerificationToken: null,
                    emailVerificationExpiry: null,
                },
            });
            (0, email_1.sendWelcomeEmail)(user.email, user.name).catch((err) => logger_1.logger.error(`Welcome email failed for ${user.email}: ${String(err)}`));
        }
        res.json({ message: 'Email verified successfully. You can now log in.' });
    }
    catch (err) {
        next(err);
    }
});
router.post('/resend-verification', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) {
            return next((0, errorHandler_1.createError)('Email is required', 400));
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true, isVerified: true },
        });
        // Always return a generic response to avoid account enumeration.
        if (!user || user.isVerified) {
            res.json({ message: 'If the account exists and is unverified, a verification email has been sent.' });
            return;
        }
        const verificationToken = crypto_1.default.randomBytes(32).toString('hex');
        const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerificationToken: verificationToken,
                emailVerificationExpiry: verificationExpiry,
            },
        });
        try {
            await (0, email_1.sendEmailVerificationEmail)(user.email, user.name, verificationToken);
        }
        catch (err) {
            logger_1.logger.error(`Verification email resend failed for ${user.email}: ${String(err)}`);
            return next((0, errorHandler_1.createError)('Unable to send verification email right now. Please try again shortly.', 503));
        }
        res.json({ message: 'If the account exists and is unverified, a verification email has been sent.' });
    }
    catch (err) {
        next(err);
    }
});
router.post('/refresh', async (req, res, next) => {
    try {
        // Read the refresh token from the httpOnly cookie rather than the
        // request body — it's never exposed to frontend JS in the first place.
        const refreshToken = (0, authCookies_1.getRefreshTokenCookie)(req);
        if (!refreshToken)
            return next((0, errorHandler_1.createError)('Refresh token required', 400));
        // If this exact token was already rotated away moments ago — most
        // likely a second browser tab's request racing another tab's, both
        // firing around the same access-token expiry — replay the same result
        // instead of rejecting it. See utils/refreshGrace.ts for why this
        // matters.
        const replay = (0, refreshGrace_1.getRotatedRefresh)(refreshToken);
        if (replay) {
            (0, authCookies_1.setRefreshTokenCookie)(req, res, replay.refreshToken);
            res.json({ accessToken: replay.accessToken });
            return;
        }
        const payload = (0, jwt_1.verifyRefreshToken)(refreshToken);
        const includePersonalId = await (0, userSchema_1.hasUserPersonalIdColumn)();
        const user = await prisma_1.prisma.user.findUnique({ where: { id: payload.userId }, select: (0, userSchema_1.buildAuthenticatedUserSelect)(includePersonalId) });
        if (!user || user.refreshToken !== refreshToken) {
            // Someone else's request may have won a race and rotated this exact
            // token in the moment between our read above and getting here (two
            // requests can both pass this point before either has committed its
            // write) — check the grace map once more before giving up, since the
            // winner's rotation may have landed while we were mid-flight.
            const replayAfterRace = (0, refreshGrace_1.getRotatedRefresh)(refreshToken);
            if (replayAfterRace) {
                (0, authCookies_1.setRefreshTokenCookie)(req, res, replayAfterRace.refreshToken);
                res.json({ accessToken: replayAfterRace.accessToken });
                return;
            }
            (0, authCookies_1.clearRefreshTokenCookie)(req, res);
            return next((0, errorHandler_1.createError)('Invalid refresh token', 401));
        }
        const accessToken = (0, jwt_1.generateAccessToken)({ userId: user.id, email: user.email, role: user.role });
        const newRefreshToken = (0, jwt_1.generateRefreshToken)({ userId: user.id, email: user.email, role: user.role });
        // Atomic compare-and-swap: only commit the rotation if `refreshToken` is
        // STILL the current value in the database (i.e. no one else's request
        // has already rotated it since we read it above). A plain
        // findUnique-then-update has a window where two concurrent requests can
        // both pass the check above before either has written — this update's
        // WHERE clause is evaluated atomically by the database, so only one of
        // two racing requests can ever actually win it.
        const rotated = await prisma_1.prisma.user.updateMany({
            where: { id: user.id, refreshToken },
            data: { refreshToken: newRefreshToken },
        });
        if (rotated.count === 0) {
            // Lost the race — another request rotated this token first. Its
            // result should already be sitting in the grace map by now.
            const replayAfterRace = (0, refreshGrace_1.getRotatedRefresh)(refreshToken);
            if (replayAfterRace) {
                (0, authCookies_1.setRefreshTokenCookie)(req, res, replayAfterRace.refreshToken);
                res.json({ accessToken: replayAfterRace.accessToken });
                return;
            }
            (0, authCookies_1.clearRefreshTokenCookie)(req, res);
            return next((0, errorHandler_1.createError)('Invalid refresh token', 401));
        }
        (0, refreshGrace_1.rememberRotatedRefresh)(refreshToken, accessToken, newRefreshToken);
        (0, authCookies_1.setRefreshTokenCookie)(req, res, newRefreshToken);
        res.json({ accessToken });
    }
    catch {
        logger_1.logger.error('Refresh token verification failed');
        (0, authCookies_1.clearRefreshTokenCookie)(req, res);
        next((0, errorHandler_1.createError)('Invalid refresh token', 401));
    }
});
router.post('/logout', async (req, res, next) => {
    try {
        // Try to revoke refresh token if present; ignore auth errors so expired
        // tokens don't block users from logging out.
        const refreshToken = (0, authCookies_1.getRefreshTokenCookie)(req);
        if (refreshToken) {
            try {
                const payload = (0, jwt_1.verifyRefreshToken)(refreshToken);
                await prisma_1.prisma.user.update({
                    where: { id: payload.userId },
                    data: { refreshToken: null },
                });
            }
            catch {
                // Token is invalid/expired – still return success so client clears local storage
            }
        }
        (0, authCookies_1.clearRefreshTokenCookie)(req, res);
        res.json({ message: 'Logged out successfully' });
    }
    catch (err) {
        next(err);
    }
});
router.post('/admin-register', async (req, res, next) => {
    try {
        const { email, password, name, adminSecret, country } = req.body;
        const expectedSecret = process.env.ADMIN_SECRET;
        if (!expectedSecret || !adminSecret || adminSecret !== expectedSecret) {
            return next((0, errorHandler_1.createError)('Invalid admin secret', 403));
        }
        if (!email || !password || !name) {
            return next((0, errorHandler_1.createError)('Email, password, and name are required', 400));
        }
        if (password.length < 8) {
            return next((0, errorHandler_1.createError)('Password must be at least 8 characters', 400));
        }
        const includePersonalId = await (0, userSchema_1.hasUserPersonalIdColumn)();
        const existing = await prisma_1.prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (existing) {
            return next((0, errorHandler_1.createError)('An account with this email already exists.', 409));
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 12);
        const newId = (0, uuid_1.v4)();
        const data = {
            id: newId,
            email,
            password: hashedPassword,
            name,
            role: 'ADMIN',
            country: country || 'UGANDA',
            isVerified: true,
        };
        if (includePersonalId) {
            data.personalId = generatePersonalId(newId);
        }
        let user;
        try {
            user = await prisma_1.prisma.user.create({
                data: data,
                select: (0, userSchema_1.buildAuthResponseUserSelect)(includePersonalId),
            });
        }
        catch (err) {
            if (isPrismaUniqueError(err)) {
                return next((0, errorHandler_1.createError)(getDuplicateAccountMessage(err), 409));
            }
            throw err;
        }
        const accessToken = (0, jwt_1.generateAccessToken)({ userId: user.id, email: user.email, role: user.role });
        const refreshToken = (0, jwt_1.generateRefreshToken)({ userId: user.id, email: user.email, role: user.role });
        await prisma_1.prisma.user.update({ where: { id: user.id }, data: { refreshToken } });
        (0, authCookies_1.setRefreshTokenCookie)(req, res, refreshToken);
        res.status(201).json({ user, accessToken });
    }
    catch (err) {
        next(err);
    }
});
// Forgot password — sends reset link via email
router.post('/forgot-password', async (req, res, next) => {
    try {
        const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
        const email = rawEmail.trim().toLowerCase();
        if (!email)
            return next((0, errorHandler_1.createError)('Email is required', 400));
        if (!isValidEmailAddress(email))
            return next((0, errorHandler_1.createError)('Please provide a valid email address', 400));
        const user = await prisma_1.prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true },
        });
        // Explicitly check if email exists — return a clear message either way.
        // We do NOT reveal whether an account exists to prevent email enumeration,
        // but we only send the reset email when the user genuinely exists.
        if (!user) {
            res.json({ message: 'If that email is registered you will receive a reset link shortly.' });
            return;
        }
        const resetToken = crypto_1.default.randomBytes(32).toString('hex');
        const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { passwordResetToken: resetToken, passwordResetExpiry: resetExpiry },
        });
        try {
            await (0, email_1.sendPasswordResetEmail)(user.email, user.name, resetToken);
        }
        catch (err) {
            logger_1.logger.error(`Password reset email failed for user ${user.id}: ${String(err)}`);
            await prisma_1.prisma.user.update({
                where: { id: user.id },
                data: { passwordResetToken: null, passwordResetExpiry: null },
            }).catch((cleanupErr) => logger_1.logger.error(`Failed to rollback password reset token for user ${user.id}: ${String(cleanupErr)}`));
            return next((0, errorHandler_1.createError)('Unable to send password reset email right now. Please try again shortly.', 503));
        }
        res.json({ message: 'If that email is registered you will receive a reset link shortly.' });
    }
    catch (err) {
        next(err);
    }
});
// Reset password — validates token and sets new password
router.post('/reset-password', async (req, res, next) => {
    try {
        const { token, password } = req.body;
        if (!token || !password)
            return next((0, errorHandler_1.createError)('Token and new password are required', 400));
        if (password.length < 6)
            return next((0, errorHandler_1.createError)('Password must be at least 6 characters', 400));
        const user = await prisma_1.prisma.user.findFirst({
            where: {
                passwordResetToken: token,
                passwordResetExpiry: { gt: new Date() },
            },
            select: { id: true },
        });
        if (!user)
            return next((0, errorHandler_1.createError)('Reset token is invalid or has expired', 400));
        const hashedPassword = await bcryptjs_1.default.hash(password, 12);
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                passwordResetToken: null,
                passwordResetExpiry: null,
                refreshToken: null, // invalidate existing sessions
            },
        });
        res.json({ message: 'Password updated successfully. You can now sign in.' });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map