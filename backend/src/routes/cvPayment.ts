/**
 * CV Payment & Download Token Routes
 *
 * Flow:
 * 1. POST /api/cv-payment/initiate  — creates a pending token, returns tokenId
 * 2. POST /api/cv-payment/confirm   — marks token as paid (real: called by payment webhook)
 * 3. GET  /api/cv-payment/token/:id — validates token; returns {valid, token} for frontend
 *
 * The frontend generates the CV HTML client-side but must hit /token/:id first
 * to confirm payment before enabling the download blob.
 */

import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { optionalAuthenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { safeEqual } from '../utils/safeEqual';
import { logger } from '../utils/logger';
import { getActiveCvPackage, resolveCvCheckoutContext, countGenerationsForOwner } from '../utils/cvPackage';

const router = Router();

// ── GET /api/cv-payment/active-package ────────────────────────────────────────
// Tells the frontend which CV package (if any) currently governs the builder,
// the exact price it should show/charge (sourced solely from that package —
// there is no hardcoded fallback), and whether this user/device has already
// hit that package's "max generated CV" limit. When no package is active (or
// the active one's duration window has elapsed) this returns
// { configured: false, package: null, price: null } and the frontend must
// disable downloading until the admin activates a package.
router.get('/active-package', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { country, deviceId } = req.query as { country?: string; deviceId?: string };
    const context = await resolveCvCheckoutContext({
      country,
      userId: req.user?.userId ?? null,
      deviceId: deviceId ?? null,
    });
    res.json(context);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/cv-payment/initiate ─────────────────────────────────────────────
// Creates a pending CvDownloadToken and returns its ID so the frontend can
// redirect to the payment gateway with it as a reference. Pricing and limits
// come exclusively from the currently active CV package — there is no
// per-country default. If no CV package is active, there is nothing to
// charge, so the request is rejected.
router.post('/initiate', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { country = 'UGANDA', deviceId, holder } = req.body as {
      country?: string;
      deviceId?: string;
      holder?: { name?: string; title?: string; email?: string; phone?: string };
    };
    const userId = req.user?.userId ?? null;

    const pkg = await getActiveCvPackage();

    if (!pkg) {
      return next(createError('No CV package is currently active — pricing has not been configured yet.', 400));
    }
    if (pkg.isFree) {
      return next(createError('This package is free — use the free download endpoint instead of paying.', 400));
    }
    const used = await countGenerationsForOwner(pkg.id, userId, deviceId ?? null);
    if (pkg.maxListings != null && used >= pkg.maxListings) {
      return next(createError(
        `You've reached the maximum of ${pkg.maxListings} CV download${pkg.maxListings === 1 ? '' : 's'} allowed under the "${pkg.name}" package.`,
        403
      ));
    }

    const price = { amount: pkg.price, currency: pkg.currency };

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

    const record = await prisma.cvDownloadToken.create({
      data: {
        userId,
        deviceId: deviceId ?? null,
        packageId: pkg.id,
        tokenHash,
        paid:      false,
        amount:    price.amount,
        currency:  price.currency,
        country,
        expiresAt,
        holderName:  holder?.name?.trim() || null,
        holderTitle: holder?.title?.trim() || null,
        holderEmail: holder?.email?.trim() || null,
        holderPhone: holder?.phone?.trim() || null,
      },
    });

    // Return the record ID and the raw token.
    // The raw token is what the client stores; the hash is what the DB stores.
    // The client presents rawToken at confirm and validate time.
    res.status(201).json({
      tokenId:   record.id,
      rawToken,                // store in sessionStorage — never exposed in URL
      amount:    price.amount,
      currency:  price.currency,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/cv-payment/free-download ─────────────────────────────────────────
// Used only when the currently active CV package is marked free. Skips the
// payment gateway entirely — issues an already-paid token (subject to the
// package's max-generations limit) so the frontend can go straight to
// /validate and download, with no payment modal shown.
router.post('/free-download', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { country = 'UGANDA', deviceId, holder } = req.body as {
      country?: string;
      deviceId?: string;
      holder?: { name?: string; title?: string; email?: string; phone?: string };
    };
    const userId = req.user?.userId ?? null;

    const pkg = await getActiveCvPackage();
    if (!pkg || !pkg.isFree) {
      return next(createError('No free CV package is currently active.', 400));
    }

    const used = await countGenerationsForOwner(pkg.id, userId, deviceId ?? null);
    if (pkg.maxListings != null && used >= pkg.maxListings) {
      return next(createError(
        `You've reached the maximum of ${pkg.maxListings} free CV download${pkg.maxListings === 1 ? '' : 's'} allowed under the "${pkg.name}" package.`,
        403
      ));
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

    const record = await prisma.cvDownloadToken.create({
      data: {
        userId,
        deviceId: deviceId ?? null,
        packageId: pkg.id,
        tokenHash,
        paid:      true, // free packages skip the payment step entirely
        amount:    0,
        currency:  pkg.currency,
        country,
        expiresAt,
        holderName:  holder?.name?.trim() || null,
        holderTitle: holder?.title?.trim() || null,
        holderEmail: holder?.email?.trim() || null,
        holderPhone: holder?.phone?.trim() || null,
      },
    });

    res.status(201).json({
      tokenId:  record.id,
      rawToken,
      amount:   0,
      currency: pkg.currency,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/cv-payment/confirm ─────────────────────────────────────────────
// Called by the payment gateway webhook (or by the frontend after a successful
// gateway callback) to mark the token as paid.
// In production: verify the gateway signature before trusting this call.
//
// SECURITY: this endpoint marks a token as PAID. The caller already holds the
// rawToken (it was returned by /initiate to the same browser), so without a
// secret ANYONE can "pay" for a paid CV package by calling /initiate then
// /confirm — which is exactly what the frontend currently does (no gateway is
// integrated yet). Set CV_PAYMENT_WEBHOOK_SECRET once a real gateway calls this
// endpoint server-to-server with the header `x-webhook-secret`; from then on
// browsers can no longer self-confirm. Until it is set the legacy behaviour is
// kept so the feature keeps working, and a warning is logged at startup.
const CV_WEBHOOK_SECRET = process.env.CV_PAYMENT_WEBHOOK_SECRET || '';
if (!CV_WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
  logger.warn('CV_PAYMENT_WEBHOOK_SECRET is not set: /api/cv-payment/confirm accepts any caller, so paid CV packages are effectively free. Integrate a payment gateway and set the secret.');
}
router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (CV_WEBHOOK_SECRET && !safeEqual(req.get('x-webhook-secret'), CV_WEBHOOK_SECRET)) {
      return next(createError('Forbidden', 403));
    }
    const { rawToken } = req.body as { rawToken?: unknown };
    if (typeof rawToken !== 'string' || !rawToken) return next(createError('rawToken is required', 400));

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const record = await prisma.cvDownloadToken.findUnique({ where: { tokenHash } });

    if (!record)                         return next(createError('Invalid token', 404));
    if (record.expiresAt < new Date())   return next(createError('Token expired', 410));
    if (record.paid)                     return res.json({ already: true, tokenId: record.id });

    await prisma.cvDownloadToken.update({
      where: { id: record.id },
      data:  { paid: true },
    });

    res.json({ confirmed: true, tokenId: record.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/cv-payment/validate/:tokenId ─────────────────────────────────────
// Called by the frontend just before triggering the download blob.
// Returns { valid: true } only when the token is paid, not expired, not used.
router.get('/validate/:tokenId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tokenId } = req.params;
    const { rawToken } = req.query as { rawToken?: string };

    if (!rawToken) return next(createError('rawToken query param required', 400));

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const record = await prisma.cvDownloadToken.findUnique({ where: { id: tokenId } });

    if (!record || record.tokenHash !== tokenHash) return res.json({ valid: false, reason: 'invalid' });
    if (!record.paid)                              return res.json({ valid: false, reason: 'unpaid' });
    if (record.expiresAt < new Date())             return res.json({ valid: false, reason: 'expired' });

    // Mark as used (single-use download unlock per token)
    if (!record.usedAt) {
      await prisma.cvDownloadToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } });
    }

    res.json({ valid: true, currency: record.currency, amount: Number(record.amount) });
  } catch (err) {
    next(err);
  }
});

export default router;
