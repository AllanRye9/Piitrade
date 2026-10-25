import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import type { PriceOffer } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { dispatchNotificationById } from '../utils/notificationDispatch';
import {
  MAX_NEW_OFFERS_PER_DAY,
  MAX_NOTE_LENGTH,
  MAX_STEPS_PER_LISTING,
  cleanNote,
  cooldownEnd,
  effectiveStatus,
  formatMoney,
  offerChatText,
  offerExpiry,
  parseAmount,
  serializeOffer,
  validateCounter,
  validateInitialOffer,
  OfferChatKind,
} from '../utils/priceOffers';

/**
 * /api/price-offers — buyer/seller price negotiation on a listing.
 *
 * Every step is a PriceOffer row plus a chat Message (so the negotiation reads naturally in the
 * thread) plus a Notification for the other party (bell + push + WhatsApp via the dispatcher).
 * All steps for one (listing, buyer) pair are serialized with a Postgres advisory lock so two
 * simultaneous taps can never produce two open offers or a double response.
 */
const router = Router();
router.use(authenticate);

const keyByUser = (req: unknown) => (req as AuthRequest).user?.userId ?? 'anon';
const createLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: keyByUser,
  message: { message: 'You are sending offers too quickly. Please wait a minute.' },
});
const respondLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: keyByUser,
  message: { message: 'You are responding too quickly. Please wait a minute.' },
});

type OfferRow = PriceOffer;

/** Serializes every step for one (listing, buyer) pair for the lifetime of the transaction. */
async function lockChain(tx: Prisma.TransactionClient, listingId: string, buyerId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`price-offer:${listingId}:${buyerId}`}))) AS t`;
}

const shortTitle = (t: string) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
const chatHref = (counterpartId: string, listingId: string) => `/messages?with=${counterpartId}&listing=${listingId}`;

/** Notification copy per event; `name` is the person who acted. */
function notificationFor(
  type: 'OFFER_RECEIVED' | 'OFFER_ACCEPTED' | 'OFFER_DECLINED' | 'OFFER_COUNTERED',
  name: string, amount: number, currency: string, title: string,
): { title: string; message: string } {
  const money = formatMoney(amount, currency);
  const item = `"${shortTitle(title)}"`;
  switch (type) {
    case 'OFFER_RECEIVED': return { title: 'New offer on your listing', message: `${name} offered ${money} for ${item}.` };
    case 'OFFER_ACCEPTED': return { title: 'Your offer was accepted 🎉', message: `${name} accepted your offer of ${money} for ${item}.` };
    case 'OFFER_DECLINED': return { title: 'Your offer was declined', message: `${name} declined your offer of ${money} for ${item}.` };
    default: return { title: 'You received a counter-offer', message: `${name} countered with ${money} for ${item}.` };
  }
}

// POST /api/price-offers — a buyer makes a first offer on a listing
router.post('/', createLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!.userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.listingId !== 'string' || !body.listingId) return next(createError('listingId is required', 400));
    const amount = parseAmount(body.amount);
    if (amount.ok === false) return next(createError(amount.message, 400));
    const note = cleanNote(body.note);
    if (note.invalid) return next(createError('The note must be text', 400));
    if (note.tooLong) return next(createError(`The note can be at most ${MAX_NOTE_LENGTH} characters`, 400));

    const listing = await prisma.listing.findUnique({
      where: { id: body.listingId },
      select: { id: true, title: true, price: true, currency: true, status: true, acceptsOffers: true, userId: true },
    });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.userId === me) return next(createError('You cannot make an offer on your own listing', 400));
    if (listing.status !== 'ACTIVE') return next(createError('This listing is no longer available', 409));
    if (!listing.acceptsOffers) return next(createError('The seller is not accepting offers on this listing', 403));
    if (!(listing.price > 0)) return next(createError('This listing has no price to negotiate', 400));
    const invalid = validateInitialOffer(amount.value, listing.price, listing.currency);
    if (invalid) return next(createError(invalid, 400));

    const startedToday = await prisma.priceOffer.count({
      where: { madeById: me, parentId: null, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    if (startedToday >= MAX_NEW_OFFERS_PER_DAY) return next(createError('You have reached today\'s offer limit. Please try again tomorrow.', 429));

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      await lockChain(tx, listing.id, me);
      const [latest, steps] = await Promise.all([
        tx.priceOffer.findFirst({ where: { listingId: listing.id, buyerId: me }, orderBy: { createdAt: 'desc' } }),
        tx.priceOffer.count({ where: { listingId: listing.id, buyerId: me } }),
      ]);
      if (steps >= MAX_STEPS_PER_LISTING) throw createError('You have reached the offer limit for this listing. Message the seller instead.', 429);
      if (latest) {
        const state = effectiveStatus(latest, now);
        if (state === 'PENDING') throw createError('You already have an open offer on this listing. Withdraw it first to make a new one.', 409);
        if (state === 'ACCEPTED') throw createError('Your offer on this listing was already accepted. Continue in the chat.', 409);
        if (state === 'DECLINED' && latest.madeById === me && latest.respondedAt && cooldownEnd(latest.respondedAt) > now) {
          throw createError('The seller declined your last offer. You can offer again after 24 hours, or message the seller.', 429);
        }
        if (latest.status === 'PENDING') {
          await tx.priceOffer.update({ where: { id: latest.id }, data: { status: 'EXPIRED' } });
        }
      }
      const buyer = await tx.user.findUnique({ where: { id: me }, select: { name: true } });
      const offer = await tx.priceOffer.create({
        data: {
          listingId: listing.id, buyerId: me, sellerId: listing.userId, madeById: me,
          amount: amount.value, currency: listing.currency, note: note.note, expiresAt: offerExpiry(now),
        },
      });
      await tx.message.create({
        data: {
          senderId: me, receiverId: listing.userId, listingId: listing.id, offerId: offer.id,
          content: offerChatText('OFFER', offer.amount, offer.currency, offer.note),
        },
      });
      const copy = notificationFor('OFFER_RECEIVED', buyer?.name ?? 'A buyer', offer.amount, offer.currency, listing.title);
      const notification = await tx.notification.create({
        data: {
          userId: listing.userId, type: 'OFFER_RECEIVED', ...copy,
          data: { offerId: offer.id, listingId: listing.id, counterpartId: me, href: chatHref(me, listing.id), linkLabel: 'Open chat' } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return { offer, notificationId: notification.id };
    });

    void dispatchNotificationById(result.notificationId);
    res.status(201).json({ offer: serializeOffer(result.offer) });
  } catch (err) {
    next(err);
  }
});

// POST /api/price-offers/:id/respond  { action: 'ACCEPT' | 'DECLINE' | 'COUNTER', amount?, note? }
// Answered by whichever party did NOT make the offer.
router.post('/:id/respond', respondLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!.userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = body.action;
    if (action !== 'ACCEPT' && action !== 'DECLINE' && action !== 'COUNTER') {
      return next(createError('action must be ACCEPT, DECLINE or COUNTER', 400));
    }
    const note = cleanNote(body.note);
    if (note.invalid) return next(createError('The note must be text', 400));
    if (note.tooLong) return next(createError(`The note can be at most ${MAX_NOTE_LENGTH} characters`, 400));
    let counterAmount = 0;
    if (action === 'COUNTER') {
      const parsed = parseAmount(body.amount);
      if (parsed.ok === false) return next(createError(parsed.message, 400));
      counterAmount = parsed.value;
    }

    const found = await prisma.priceOffer.findUnique({ where: { id: req.params.id }, select: { id: true, buyerId: true, sellerId: true, listingId: true } });
    // 404 (not 403) for strangers so offer ids cannot be probed.
    if (!found || (found.buyerId !== me && found.sellerId !== me)) return next(createError('Offer not found', 404));

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      await lockChain(tx, found.listingId, found.buyerId);
      const offer = await tx.priceOffer.findUnique({
        where: { id: found.id },
        include: { listing: { select: { id: true, title: true, price: true, status: true } } },
      });
      if (!offer) throw createError('Offer not found', 404);
      if (offer.madeById === me) throw createError('You made this offer. Wait for the other person to answer it, or withdraw it.', 403);

      const state = effectiveStatus(offer, now);
      if (state !== 'PENDING') {
        // Persist the expiry, then report the conflict AFTER the transaction commits (throwing here would roll the write back).
        if (offer.status === 'PENDING') await tx.priceOffer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } });
        return {
          conflict: state === 'EXPIRED' ? 'This offer has expired.' : state === 'WITHDRAWN' ? 'This offer was withdrawn.' : 'This offer has already been answered.',
        };
      }
      if (action !== 'DECLINE' && offer.listing.status !== 'ACTIVE') throw createError('This listing is no longer available', 409);

      const other = me === offer.buyerId ? offer.sellerId : offer.buyerId;
      const meRow = await tx.user.findUnique({ where: { id: me }, select: { name: true } });
      const name = meRow?.name ?? 'The other party';
      const href = chatHref(me, offer.listingId);

      const finish = async (
        kind: OfferChatKind, notifType: 'OFFER_ACCEPTED' | 'OFFER_DECLINED' | 'OFFER_COUNTERED',
        amountShown: number, resultOffer: OfferRow, cardOfferId: string | null,
      ) => {
        await tx.message.create({
          data: {
            senderId: me, receiverId: other, listingId: offer.listingId, offerId: cardOfferId,
            content: offerChatText(kind, amountShown, offer.currency, note.note),
          },
        });
        const copy = notificationFor(notifType, name, amountShown, offer.currency, offer.listing.title);
        const notification = await tx.notification.create({
          data: {
            userId: other, type: notifType, ...copy,
            data: { offerId: resultOffer.id, listingId: offer.listingId, counterpartId: me, href, linkLabel: 'Open chat' } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        return { offer: resultOffer, notificationId: notification.id };
      };

      if (action === 'ACCEPT') {
        const updated = await tx.priceOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', respondedAt: now } });
        return finish('ACCEPTED', 'OFFER_ACCEPTED', offer.amount, updated, null);
      }
      if (action === 'DECLINE') {
        const updated = await tx.priceOffer.update({ where: { id: offer.id }, data: { status: 'DECLINED', respondedAt: now } });
        return finish('DECLINED', 'OFFER_DECLINED', offer.amount, updated, null);
      }

      // COUNTER
      const steps = await tx.priceOffer.count({ where: { listingId: offer.listingId, buyerId: offer.buyerId } });
      if (steps >= MAX_STEPS_PER_LISTING) throw createError('This negotiation has reached its limit. Accept, decline, or continue in the chat.', 429);
      const parent = offer.parentId ? await tx.priceOffer.findUnique({ where: { id: offer.parentId }, select: { amount: true } }) : null;
      const ownPrevious = parent ? parent.amount : me === offer.sellerId ? offer.listing.price : offer.amount;
      const invalid = validateCounter(counterAmount, offer.amount, ownPrevious, offer.currency);
      if (invalid) throw createError(invalid, 400);

      await tx.priceOffer.update({ where: { id: offer.id }, data: { status: 'COUNTERED', respondedAt: now } });
      const next = await tx.priceOffer.create({
        data: {
          listingId: offer.listingId, buyerId: offer.buyerId, sellerId: offer.sellerId, madeById: me,
          amount: counterAmount, currency: offer.currency, note: note.note, parentId: offer.id, expiresAt: offerExpiry(now),
        },
      });
      return finish('COUNTER', 'OFFER_COUNTERED', counterAmount, next, next.id);
    });

    if ('conflict' in result) return next(createError(result.conflict, 409));
    void dispatchNotificationById(result.notificationId);
    res.json({ offer: serializeOffer(result.offer) });
  } catch (err) {
    next(err);
  }
});

// POST /api/price-offers/:id/withdraw — the maker takes back their own open offer
router.post('/:id/withdraw', respondLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!.userId;
    const found = await prisma.priceOffer.findUnique({ where: { id: req.params.id } });
    if (!found || (found.buyerId !== me && found.sellerId !== me)) return next(createError('Offer not found', 404));
    if (found.madeById !== me) return next(createError('Only the person who made an offer can withdraw it', 403));

    const updated = await prisma.$transaction(async (tx) => {
      await lockChain(tx, found.listingId, found.buyerId);
      const fresh = await tx.priceOffer.findUnique({ where: { id: found.id } });
      if (!fresh) throw createError('Offer not found', 404);
      if (effectiveStatus(fresh) !== 'PENDING') throw createError('This offer can no longer be withdrawn', 409);
      return tx.priceOffer.update({ where: { id: fresh.id }, data: { status: 'WITHDRAWN', respondedAt: new Date() } });
    });
    res.json({ offer: serializeOffer(updated) });
  } catch (err) {
    next(err);
  }
});

// GET /api/price-offers/listing/:listingId/mine — what the listing page needs to render its offer UI
router.get('/listing/:listingId/mine', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!.userId;
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.listingId },
      select: { id: true, userId: true, status: true, price: true, acceptsOffers: true },
    });
    if (!listing) return next(createError('Listing not found', 404));
    res.set('Cache-Control', 'private, no-store');

    if (listing.userId === me) {
      const pendingCount = await prisma.priceOffer.count({
        where: { listingId: listing.id, sellerId: me, status: 'PENDING', madeById: { not: me }, expiresAt: { gt: new Date() } },
      });
      return res.json({ isOwner: true, acceptsOffers: listing.acceptsOffers, canOffer: false, pendingCount, offer: null });
    }

    const now = new Date();
    const latest = await prisma.priceOffer.findFirst({ where: { listingId: listing.id, buyerId: me }, orderBy: { createdAt: 'desc' } });
    let reason: string | null = null;
    if (listing.status !== 'ACTIVE') reason = 'This listing is no longer available';
    else if (!listing.acceptsOffers) reason = 'The seller is not accepting offers on this listing';
    else if (!(listing.price > 0)) reason = 'This listing has no price to negotiate';
    else if (latest) {
      const state = effectiveStatus(latest, now);
      if (state === 'PENDING') reason = 'You have an open offer on this listing';
      else if (state === 'ACCEPTED') reason = 'Your offer was accepted';
      else if (state === 'DECLINED' && latest.madeById === me && latest.respondedAt && cooldownEnd(latest.respondedAt) > now) {
        reason = 'The seller declined your last offer. You can offer again later';
      }
    }
    res.json({
      isOwner: false,
      acceptsOffers: listing.acceptsOffers,
      canOffer: reason === null,
      reason,
      offer: latest ? serializeOffer(latest, now) : null,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/price-offers/listing/:listingId/settings  { acceptsOffers: boolean } — owner only
router.put('/listing/:listingId/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { acceptsOffers } = (req.body ?? {}) as { acceptsOffers?: unknown };
    if (typeof acceptsOffers !== 'boolean') return next(createError('acceptsOffers must be true or false', 400));
    const listing = await prisma.listing.findUnique({ where: { id: req.params.listingId }, select: { id: true, userId: true } });
    if (!listing) return next(createError('Listing not found', 404));
    if (listing.userId !== req.user!.userId) return next(createError('Forbidden', 403));
    await prisma.listing.update({ where: { id: listing.id }, data: { acceptsOffers } });
    logger.info(`Listing ${listing.id} acceptsOffers=${acceptsOffers}`);
    res.json({ acceptsOffers });
  } catch (err) {
    next(err);
  }
});

export default router;
