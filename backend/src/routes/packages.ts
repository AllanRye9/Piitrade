import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { sendSubscriptionActivatedEmail } from '../utils/email';
import {
  getCurrentSubscription, toSubscriptionView, loadListingEntitlement, daysRemaining,
  subscribeToPackage, cancelOwnSubscription, startsActiveImmediately,
} from '../utils/subscriptionService';

const router = Router();

const PACKAGE_SCOPES = ['LISTING', 'CV', 'STORE'] as const;
type PackageScope = (typeof PACKAGE_SCOPES)[number];

function parseScope(scope?: string): PackageScope {
  if (!scope) return 'LISTING';
  if (PACKAGE_SCOPES.includes(scope as PackageScope)) return scope as PackageScope;
  throw createError('scope must be LISTING, CV or STORE', 400);
}

// ─── Public: list active packages ─────────────────────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = parseScope(req.query.scope as string | undefined);
    res.set('Cache-Control', 'no-store'); // admin package changes must show on the next check

    const packages = await prisma.sellerPackage.findMany({
      where: { isActive: true, scope },
      orderBy: [{ isFree: 'desc' }, { price: 'asc' }],
    });
    res.json({ packages });
  } catch (err) {
    next(err);
  }
});

// ─── Authenticated: the caller's current subscription (real time) ─────────────
// Status is derived from the dates at the moment of the request, so a lapsed subscription is
// reported EXPIRED immediately — no background job has to have run first, and a GET never writes.
// `subscription` keeps its old shape (the package record is included) with extra fields added.

router.get('/my-subscription', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const scope = parseScope(req.query.scope as string | undefined);
    const now = new Date();

    const [current, pending, scheduled] = await Promise.all([
      getCurrentSubscription(userId, scope, prisma, now),
      prisma.sellerSubscription.findFirst({
        where: { userId, status: 'PENDING_PAYMENT', package: { scope } },
        include: { package: true },
        orderBy: { createdAt: 'desc' },
      }),
      // Approved, but its term has not begun: an upgrade waiting for the current plan to end.
      prisma.sellerSubscription.findFirst({
        where: { userId, status: 'ACTIVE', startDate: { gt: now }, package: { scope } },
        include: { package: true },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    res.json({
      subscription: current ? { ...current, ...toSubscriptionView(current, now), package: current.package } : null,
      pending: pending ? { ...pending, ...toSubscriptionView(pending, now), package: pending.package } : null,
      scheduled: scheduled ? { ...scheduled, ...toSubscriptionView(scheduled, now), package: scheduled.package } : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /packages/my-subscriptions?scope=LISTING&page=1&limit=20 — full history, newest first.
router.get('/my-subscriptions', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const scope = parseScope(req.query.scope as string | undefined);
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const now = new Date();
    const where = { userId, package: { scope } };
    const [total, rows] = await Promise.all([
      prisma.sellerSubscription.count({ where }),
      prisma.sellerSubscription.findMany({ where, include: { package: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    res.json({
      subscriptions: rows.map((s) => ({ ...s, ...toSubscriptionView(s, now), package: s.package })),
      total, page, pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /packages/my-entitlements — what the caller may post right now and how much of it is used.
// Source is the live merchant, a current subscription, or the ordinary-account baseline.
router.get('/my-entitlements', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const now = new Date();
    const [listing, used] = await Promise.all([
      loadListingEntitlement(userId, prisma, now),
      prisma.listing.count({ where: { userId, status: { in: ['ACTIVE', 'PENDING'] } } }),
    ]);
    res.json({
      listing: {
        ...listing,
        used,
        remaining: listing.maxListings === null ? null : Math.max(0, listing.maxListings - used),
        daysRemaining: listing.expiresAt ? daysRemaining(listing.expiresAt, now) : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Authenticated: subscribe to a package ────────────────────────────────────

router.post('/:id/subscribe', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    // MTN MoMo is the only way to pay (POST /api/payments/momo/initiate creates the request itself),
    // so this route only starts packages that need no payment: the free trial.
    const target = await prisma.sellerPackage.findUnique({ where: { id: req.params.id }, select: { isFree: true, price: true, isActive: true } });
    if (target && target.isActive && !startsActiveImmediately(target)) {
      return next(createError('Paid packages are bought with MTN Mobile Money.', 400));
    }
    // Everything — the one-free-trial rule, the "already subscribed" checks and the insert — runs
    // in one transaction under a per-user lock, so two quick taps can't both succeed.
    const { subscription, activated } = await subscribeToPackage(userId, req.params.id, req.body?.paymentRef);

    if (activated && !subscription.package.isFree) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (user?.email) {
        sendSubscriptionActivatedEmail(user.email, user.name ?? 'Member', subscription.packageName ?? subscription.package.name, subscription.endDate)
          .catch(() => undefined);
      }
    }
    res.status(201).json({ subscription: { ...subscription, ...toSubscriptionView(subscription), package: subscription.package } });
  } catch (err) {
    next(err);
  }
});

// ─── Upgrades and renewals are paid with MTN MoMo ─────────────────────────────

// MTN MoMo is the only way to pay. POST /api/payments/momo/initiate (purposes SUBSCRIPTION_UPGRADE /
// SUBSCRIPTION_RENEWAL) creates the pending request and takes the payment in one step, so the old
// "type a payment reference and wait for an admin" routes are closed. (Requests that were already
// queued that way can still be approved by an admin.)
router.post('/:id/upgrade', authenticate, (_req: Request, _res: Response, next: NextFunction) =>
  next(createError('Upgrades are paid with MTN Mobile Money.', 400)));
router.post('/subscriptions/:id/renew', authenticate, (_req: Request, _res: Response, next: NextFunction) =>
  next(createError('Renewals are paid with MTN Mobile Money.', 400)));

// POST /packages/subscriptions/:id/cancel — cancels the caller's own subscription, queued upgrade or pending request.
router.post('/subscriptions/:id/cancel', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subscription = await cancelOwnSubscription((req as AuthRequest).user!.userId, req.params.id);
    res.json({ subscription });
  } catch (err) {
    next(err);
  }
});

export default router;
