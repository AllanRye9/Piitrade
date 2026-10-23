/**
 * CV Payment & Download Token Routes
 *
 * Flow:
 * 1. POST /api/cv-payment/initiate  — creates a pending token, returns tokenId
 * 2. POST /api/cv-payment/confirm   — marks token as paid (real: called by payment webhook)
 * 3. POST /api/cv-payment/validate/:id — releases one (capped) download for a paid token
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
// integrated yet). Browsers can never self-confirm: without CV_PAYMENT_WEBHOOK_SECRET this
// endpoint is closed (payments are confirmed by the MoMo service), and with it set only a
// server-to-server caller sending the header `x-webhook-secret` is accepted.
const CV_WEBHOOK_SECRET = process.env.CV_PAYMENT_WEBHOOK_SECRET || '';
router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (CV_WEBHOOK_SECRET && !safeEqual(req.get('x-webhook-secret'), CV_WEBHOOK_SECRET)) {
      return next(createError('Forbidden', 403));
    }
    // MTN MoMo is the only payment method: a download is unlocked by a payment MTN has confirmed
    // (utils/momo/paymentService.ts). Without the gateway secret a browser must never be able to
    // mark a token paid itself.
    if (!CV_WEBHOOK_SECRET) {
      return next(createError('Payments are confirmed automatically once the mobile money payment completes.', 403));
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

// ── POST /api/cv-payment/validate/:tokenId ────────────────────────────────────
// Called by the frontend just before it builds the download. Each successful call RELEASES one
// download from the token: the count is incremented atomically, and once CV_MAX_DOWNLOADS_PER_TOKEN
// is reached (default 3 — enough for a print retry or a lost file) the token is spent. One payment
// therefore no longer buys unlimited downloads for 24h. The secret is sent in the body, not the URL,
// so it never lands in access logs.
//
// Known limit: the CV itself is still rendered in the browser, so this bounds how often the server
// will say "valid", it cannot stop someone who already holds the rendered HTML from reprinting it.
// Truly server-enforced gating needs server-side rendering (headless browser / PDF service).
const CV_MAX_DOWNLOADS_PER_TOKEN = Math.min(10, Math.max(1, Number(process.env.CV_MAX_DOWNLOADS_PER_TOKEN) || 3));
router.post('/validate/:tokenId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tokenId } = req.params;
    const rawToken = (req.body as { rawToken?: unknown } | undefined)?.rawToken;
    if (typeof rawToken !== 'string' || !rawToken) return next(createError('rawToken is required', 400));

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = new Date();

    // One atomic step: only a paid, unexpired token with downloads left is released.
    const released = await prisma.cvDownloadToken.updateMany({
      where: { id: tokenId, tokenHash, paid: true, expiresAt: { gt: now }, downloadCount: { lt: CV_MAX_DOWNLOADS_PER_TOKEN } },
      data: { downloadCount: { increment: 1 } },
    });

    if (released.count !== 1) {
      const record = await prisma.cvDownloadToken.findUnique({ where: { id: tokenId } });
      if (!record || !safeEqual(record.tokenHash, tokenHash)) return res.json({ valid: false, reason: 'invalid' });
      if (!record.paid)                                        return res.json({ valid: false, reason: 'unpaid' });
      if (record.expiresAt <= now)                             return res.json({ valid: false, reason: 'expired' });
      return res.json({ valid: false, reason: 'limit' });
    }

    // First release marks the token used (this is what counts towards the package's CV limit).
    await prisma.cvDownloadToken.updateMany({ where: { id: tokenId, usedAt: null }, data: { usedAt: now } });
    const record = await prisma.cvDownloadToken.findUniqueOrThrow({ where: { id: tokenId } });

    res.json({
      valid: true, currency: record.currency, amount: Number(record.amount),
      downloadsRemaining: Math.max(0, CV_MAX_DOWNLOADS_PER_TOKEN - record.downloadCount),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
