/**
 * Mobile-money payments (MTN MoMo, collection only).
 *
 *   GET  /api/payments/config                       public — { momoEnabled, currency, environment }
 *   POST /api/payments/momo/initiate                start a payment (login required, except CV downloads)
 *   GET  /api/payments/:id                          poll a payment (owner / admin)
 *   POST /api/payments/:id/status                   same, for guests: proves ownership with the CV token secret in the body
 *   PUT|POST /api/payments/momo/callback/:referenceId   MTN's callback (signed URL; only triggers a re-check with MTN)
 *   GET  /api/payments/receipts                     my receipts (login required)
 *   GET  /api/payments/receipts/verify?code=…       public: is this receipt tracking code genuine?
 *   GET  /api/payments/:id/receipt.pdf              download the receipt PDF (owner / admin)
 *   POST /api/payments/:id/receipt/email            email the receipt PDF to me again (owner)
 *   GET  /api/payments/admin/status                 admin: is MoMo on, and if not, exactly why (variable names only, never values)
 *   GET  /api/payments/admin/list                   admin: payments ledger
 *   POST /api/payments/admin/:id/verify             admin: re-check with MTN now
 *   POST /api/payments/admin/:id/resolve            admin: close a NEEDS_REVIEW payment by hand; body { note, outcome: GRANTED | REFUNDED }
 *
 * The amount is NEVER taken from the request — it is derived on the server from the thing being
 * bought (see utils/momo/paymentService.ts).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { PaymentPurpose } from '@prisma/client';
import { authenticate, authorize, optionalAuthenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { isMomoEnabled, loadMomoConfig, describeMomoConfigProblems } from '../utils/momo/config';
import { listReceiptsForUser, getReceiptPdfForActor, resendReceiptEmail, verifyReceiptCode } from '../utils/momo/receipt';
import {
  initiatePayment, getPaymentForActor, handleCallback, verifyPayment, toPaymentView, listPayments, resolveReviewedPayment, Actor,
} from '../utils/momo/paymentService';

const router = Router();

const PURPOSES: PaymentPurpose[] = ['SUBSCRIPTION', 'SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_UPGRADE', 'STORE_RENTAL', 'STORE_RENEWAL', 'LISTING_TIER', 'CV_DOWNLOAD'];

const actorOf = (req: AuthRequest): Actor => ({ userId: req.user?.userId ?? null, role: req.user?.role ?? null });

// Never cache payment state anywhere between us and the payer.
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

router.get('/config', (_req: Request, res: Response) => {
  const enabled = isMomoEnabled();
  res.json({ momoEnabled: enabled, currency: 'UGX', environment: enabled ? loadMomoConfig().environment : null });
});

router.post('/momo/initiate', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.purpose !== 'string' || !PURPOSES.includes(b.purpose as PaymentPurpose)) throw createError('A valid payment purpose is required', 400);
    const { payment, resumed } = await initiatePayment(actorOf(req), {
      purpose: b.purpose as PaymentPurpose,
      msisdn: b.msisdn,
      packageId: b.packageId,
      upgradeMode: b.upgradeMode,
      subscriptionId: b.subscriptionId,
      rentalId: b.rentalId,
      listingId: b.listingId,
      tier: b.tier,
      tokenId: b.tokenId,
      rawToken: b.rawToken,
    });
    res.status(resumed ? 200 : 201).json({ payment, resumed });
  } catch (err) {
    next(err);
  }
});

// MTN's callback. The signature in the URL only proves the URL is ours; the body is ignored.
const callback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await handleCallback(req.params.referenceId, req.query.s);
    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
};
router.put('/momo/callback/:referenceId', callback);
router.post('/momo/callback/:referenceId', callback);

// ── Admin (declared before /:id so "admin" is never read as a payment id) ──────

// Receipts. Registered BEFORE the generic `/:id` routes so "receipts" is never read as a payment id.
router.get('/receipts', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ receipts: await listReceiptsForUser(req.user!.userId) });
  } catch (err) {
    next(err);
  }
});

// Public, deliberately minimal (no names or phone numbers), rate limited so codes cannot be guessed.
const verifyHits = new Map<string, { n: number; reset: number }>();
router.get('/receipts/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const hit = verifyHits.get(key);
    if (!hit || hit.reset < now) verifyHits.set(key, { n: 1, reset: now + 60_000 });
    else if (++hit.n > 20) throw createError('Too many checks. Please wait a minute and try again.', 429);
    if (verifyHits.size > 5000) for (const [k, v] of verifyHits) if (v.reset < now) verifyHits.delete(k);
    res.json(await verifyReceiptCode(req.query.code));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/receipt.pdf', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename, pdf } = await getReceiptPdfForActor(String(req.params.id), actorOf(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/receipt/email', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sent = await resendReceiptEmail(String(req.params.id), req.user!.userId);
    res.json({ sent });
  } catch (err) {
    next(err);
  }
});

// Why is MoMo on or off? The public /config only says true/false; this tells an admin what to fix.
// Lists problems by variable name only — it never returns a key, user id or secret.
router.get('/admin/status', authenticate, authorize('ADMIN'), (_req: Request, res: Response) => {
  const switchedOn = (process.env.MTN_ENABLED ?? '').trim().toLowerCase() === 'true';
  const problems = [
    ...(switchedOn ? [] : ['MTN_ENABLED is not set to "true"']),
    ...describeMomoConfigProblems(),
  ];
  const enabled = isMomoEnabled();
  res.json({ enabled, environment: loadMomoConfig().environment, problems: enabled ? [] : problems });
});

router.get('/admin/list', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json(await listPayments({ status: q.status, purpose: q.purpose, search: q.search, page: parseInt(q.page ?? '1', 10) || 1, limit: parseInt(q.limit ?? '25', 10) || 25 }));
  } catch (err) {
    next(err);
  }
});

router.post('/admin/:id/verify', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ payment: toPaymentView(await verifyPayment(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/:id/resolve', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    res.json({ payment: await resolveReviewedPayment(req.params.id, note, req.user!.userId, req.body?.outcome) });
  } catch (err) {
    next(err);
  }
});

// ── Payer polling ──────────────────────────────────────────────────────────────

router.get('/:id', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ payment: await getPaymentForActor(req.params.id, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/status', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ payment: await getPaymentForActor(req.params.id, actorOf(req), req.body?.rawToken) });
  } catch (err) {
    next(err);
  }
});

export default router;
