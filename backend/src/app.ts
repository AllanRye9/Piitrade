import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import { rateLimit } from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import listingRoutes from './routes/listings';
import homeLayoutRoutes from './routes/homeLayout';
import categoryRoutes from './routes/categories';
import reportRoutes from './routes/reports';
import reviewRoutes from './routes/reviews';
import adminRoutes from './routes/admin';
import { normalizeGeneralSettings } from './utils/siteSettings';
import { maintenanceGate } from './middleware/maintenance';
import uploadRoutes from './routes/upload';
import statsRoutes from './routes/stats';
import docRoutes from './routes/doc';
import notificationRoutes from './routes/notifications';
import storeRoutes from './routes/stores';
import packageRoutes from './routes/packages';
import imagesRoutes from './routes/images';
import siteMediaRoutes from './routes/siteMedia';
import blogRoutes from './routes/blog';
import storeRentalRoutes from './routes/storeRentals';
import cvServiceRequestRoutes from './routes/cvServiceRequests';
import cvPaymentRoutes from './routes/cvPayment';
import paymentRoutes from './routes/payments';
import supportRoutes from './routes/support';
import jobRoutes from './routes/jobs';
import currencyRatesRoutes from './routes/currencyRates';
import commodityPricesRoutes from './routes/commodityPrices';
import farmerMarketplaceRoutes from './routes/farmerMarketplace';
import kycRoutes from './routes/kyc';
import messageRoutes from './routes/messages';
import savedSearchRoutes from './routes/savedSearches';
import priceOfferRoutes from './routes/priceOffers';
import pushRoutes from './routes/push';
import alertRoutes from './routes/alerts';
import { getServiceReadiness } from './utils/serviceConfig';
import { getAllowedOrigins } from './utils/corsOrigins';
import { rejectObjectQuery } from './middleware/rejectObjectQuery';
import { invalidateCategoryCounts } from './utils/categoryCounts';
import { isPrivateStorageKey } from './utils/uploadGuard';

const app = express();

// Trust the first reverse-proxy hop (Railway, Render, nginx, etc.) so that
// express-rate-limit (and req.ip) use the real client IP from X-Forwarded-For
// instead of the proxy's IP.  Without this, express-rate-limit v7+ throws a
// ValidationError when X-Forwarded-For is present but trust proxy is false.
app.set('trust proxy', 1);

// Support a comma-separated list of allowed origins in CORS_ORIGIN so that
// multiple deployment URLs (e.g. Railway + Render) can be whitelisted without
// requiring code changes.
// (A "*" entry is deliberately ignored — see utils/corsOrigins.ts.)
const allowedOrigins = getAllowedOrigins();

// CORS must be registered before helmet so that CORS response headers
// (Access-Control-Allow-Origin, etc.) are present on every response –
// including preflight OPTIONS replies – before helmet adds its own
// restrictive Cross-Origin-* headers.
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. server-to-server, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Return false instead of an error so the response still gets CORS
    // headers (the browser can read the rejection) rather than blowing up
    // the request entirely.
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Explicitly handle all OPTIONS preflight requests so that CORS headers
// are always present — even on routes that don't otherwise accept OPTIONS.
app.options('*', cors(corsOptions));

// Security middleware – configured so its Cross-Origin-* defaults do not
// strip or conflict with the CORS headers set above.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: false,
}));

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Unauthenticated, so it reports ONLY ready / not ready. It used to echo which
// env vars were missing, whether S3/Resend/SMTP were configured and the S3
// endpoint URL — reconnaissance data for an attacker.
app.get('/health/services', (_req: Request, res: Response) => {
  const readiness = getServiceReadiness();
  const ok = readiness.jwt.ready;
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'error' });
});

app.get('/ready', (_req: Request, res: Response) => {
  res.sendStatus(200);
});

// General API rate limit — generous enough for normal multi-tab browsing.
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Strict limiter for registration / admin-register (per IP).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,       // 15 minutes
  max: 20,                          // 20 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a few minutes before trying again.' },
});

// Login is limited PER ACCOUNT (ip + email) counting only failures, so one
// attacker can't hammer a single account, while the many users who share one
// public IP (mobile-carrier CGNAT is the norm in Uganda) don't lock each other
// out. A looser per-IP ceiling still stops one host spraying many accounts.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${req.ip}|${String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254)}`,
  message: { message: 'Too many failed sign-in attempts. Please wait a few minutes before trying again.' },
});
// Ceiling per ACCOUNT regardless of IP, so rotating addresses cannot multiply the 10-per-IP allowance
// against one target (admins especially). Deliberately high: it also lets someone lock a victim out
// for the window, so it only trips on sustained guessing, not on a few typos.
const loginGlobalAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `acct|${String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254)}`,
  message: { message: 'Too many failed sign-in attempts for this account. Please wait a while or reset your password.' },
});
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many failed sign-in attempts. Please wait a few minutes before trying again.' },
});

// Email-sending / token endpoints: stop mail-bombing a victim and token guessing.
const emailFlowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a few minutes before trying again.' },
});
const tokenFlowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a few minutes before trying again.' },
});
// Refresh needs a valid secret cookie to do anything, and legitimately fires per
// tab around every token expiry, so its ceiling is deliberately generous.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Light limiter for /api/users/me — called on every page load and tab focus.
// 300 per 15 minutes allows up to ~20 reloads/minute for a single browser.
const meLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
// Reject ?a[b]=c style nested query objects (Prisma operator injection) — see middleware/rejectObjectQuery.ts
app.use(rejectObjectQuery);

// Real-time category counts: any successful write to something that can change what is visible
// (listings, moderation, stores/rentals, jobs, reports, user bans) drops the counts cache, so the
// nav and category highlights reflect it on the very next request. One place instead of every
// listing write site; background jobs invalidate themselves.
const COUNT_AFFECTING = /^\/api\/(listings|admin|stores|store-rentals|jobs|reports|users|upload)(\/|$)/;
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && COUNT_AFFECTING.test(req.path)) {
    res.on('finish', () => { if (res.statusCode < 400) invalidateCategoryCounts(); });
  }
  next();
});
app.use(express.urlencoded({ extended: true }));
// Never compress the alert stream: gzip buffers small writes, which would hold an alert back.
app.use(compression({ filter: (req, res) => (req.path === '/api/alerts/stream' ? false : compression.filter(req, res)) }));

// Logging
// Secrets travel in query strings in a few places (MoMo callback signature `s`, legacy `rawToken`
// links, reset tokens): never write them to the access log.
morgan.token('safe-url', (req) => String((req as { originalUrl?: string }).originalUrl || req.url).replace(/([?&](?:s|sig|signature|rawToken|token|code)=)[^&]*/gi, '$1[redacted]'));
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', {
  stream: { write: (message) => logger.info(message.trim()) },
}));

// User documents (CVs, certificates, ID uploads — some marked private) are
// stored under uploads/documents/ when running on the local-filesystem
// fallback. Block that prefix from the plain static mount below — it has no
// concept of auth/ownership at all — so those files are only reachable
// through the authenticated GET /api/upload/documents/:id/file route, which
// checks ownership/visibility before streaming anything. This must be
// registered before the general static mount so it takes precedence.
// The same applies to KYC identity photos (kyc/): they are served only by the
// authenticated GET /api/upload/kyc-file route.
app.use('/uploads', (req: Request, res: Response, next) => {
  let key = req.path;
  try { key = decodeURIComponent(req.path); } catch { /* keep raw */ }
  if (key.includes('..') || isPrivateStorageKey(key)) {
    res.status(403).json({ message: 'Not accessible directly' });
    return;
  }
  next();
});

// Serve uploaded images as static files. Only inert, image/video content ever
// reaches this folder (see utils/uploadGuard.ts) and nosniff is set by helmet.
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), { dotfiles: 'deny', index: false }));

// Maintenance mode (Admin → Settings): 503s the public API, admins and sign-in exempt.
app.use('/api', maintenanceGate);

// Routes
app.use('/api/auth/login', loginAccountLimiter, loginGlobalAccountLimiter, loginIpLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/admin-register', authLimiter);
app.use('/api/auth/forgot-password', emailFlowLimiter);
app.use('/api/auth/resend-verification', emailFlowLimiter);
app.use('/api/auth/reset-password', tokenFlowLimiter);
// Password change / account closure / data export each verify a password or build a large export.
app.use('/api/users/me/password', tokenFlowLimiter);
app.use('/api/users/me/delete', tokenFlowLimiter);
app.use('/api/users/me/export', tokenFlowLimiter);
app.use('/api/auth/verify-email', tokenFlowLimiter);
app.use('/api/auth/refresh', refreshLimiter);

// Public / cost-bearing endpoints. /support/chat spends LLM credits on anonymous
// traffic; the others write rows for anyone. Tight per-IP ceilings keep one host
// from draining the LLM budget or flooding tables (global limiter is far too loose).
const publicWriteLimiter = (windowMinutes: number, max: number, message: string) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message },
});
app.use('/api/support/chat', publicWriteLimiter(10, 20, 'Too many chat messages. Please wait a few minutes.'));
app.use('/api/support/handoff', publicWriteLimiter(60, 5, 'Too many support requests. Please try again later.'));
app.post('/api/cv-service-requests', publicWriteLimiter(60, 10, 'Too many requests. Please try again later.'));
app.post('/api/cv-payment/initiate', publicWriteLimiter(15, 20, 'Too many attempts. Please wait a few minutes.'));
app.post('/api/payments/momo/initiate', publicWriteLimiter(15, 20, 'Too many payment attempts. Please wait a few minutes.'));
app.post('/api/cv-payment/free-download', publicWriteLimiter(15, 20, 'Too many attempts. Please wait a few minutes.'));
app.post('/api/cv-payment/confirm', publicWriteLimiter(15, 30, 'Too many attempts. Please wait a few minutes.'));
app.post('/api/stats/track', publicWriteLimiter(1, 120, 'Too many events.'));
app.post('/api/listings/:id/engagement', publicWriteLimiter(1, 60, 'Too many events.'));
app.post('/api/listings/suggest-tags', publicWriteLimiter(10, 30, 'Too many AI requests. Please wait a few minutes.'));
app.post('/api/farmer-marketplace/posts', publicWriteLimiter(15, 10, 'Too many posts. Please wait a few minutes.'));
app.post('/api/farmer-marketplace/posts/:id/offers', publicWriteLimiter(15, 20, 'Too many offers. Please wait a few minutes.'));
app.use('/api/users/me', meLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
// Public, non-personal feeds: let browsers and the CDN reuse them briefly (headers set by a route itself win).
const shortPublicCache = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
  next();
};
app.get(['/api/listings/latest-collections', '/api/listings/featured-deal', '/api/listings/popular-searches', '/api/site-media'], shortPublicCache);
app.use('/api/listings', listingRoutes);
app.use('/api/home-layout', homeLayoutRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/doc', docRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/site-media', siteMediaRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/store-rentals', storeRentalRoutes);
app.use('/api/cv-service-requests', cvServiceRequestRoutes);
app.use('/api/cv-payment', cvPaymentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/currency-rates', currencyRatesRoutes);
app.use('/api/commodity-prices', commodityPricesRoutes);
app.use('/api/farmer-marketplace', farmerMarketplaceRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/saved-searches', savedSearchRoutes);
app.use('/api/price-offers', priceOfferRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/support', supportRoutes);

// ─── Public site config (whatsapp number, today's deals, header theme) ────────
// Publicly readable – no auth required so the frontend can load it on every page.
app.get('/api/public/site-config', async (_req: Request, res: Response) => {
  try {
    const { prisma: db } = await import('./utils/prisma');
    const config = await db.siteConfig.upsert({
      where: { id: 'global' },
      create: { id: 'global' },
      update: {},
    });
    // specialFindsEnabled lives in generalSettings (same admin-configurable
    // JSON blob as maintenanceMode/allowRegistration — see PUT /admin/settings)
    // rather than its own SiteConfig column, so no migration was needed.
    const general = normalizeGeneralSettings(config.generalSettings as Record<string, unknown> | null);
    const specialFindsEnabled = general.specialFindsEnabled;
    const now = new Date();
    const allDeals = (config.todaysDeals as Array<{ expiresAt?: string | null } & Record<string, unknown>>) || [];
    // Filter: keep deals with no expiry (unlimited) or whose expiry is in the future
    const activeDeals = allDeals.filter((d) => !d.expiresAt || new Date(d.expiresAt) > now);
    // Allow browsers/CDNs to cache for 60 s; stale-while-revalidate lets the
    // next request be served from cache while the backend refreshes in the background.
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({
      whatsappNumber: config.whatsappNumber || null,
      todaysDeals: activeDeals,
      logoUrl: config.logoUrl || null,
      logoPages: (config.logoPages as string[]) || [],
      logoAltText: config.logoAltText || null,
      logoSize: config.logoSize || 28,
      logoLinkUrl: config.logoLinkUrl || null,
      logoDisplayMode: config.logoDisplayMode || 'inline',
      interviewDemoVideoUrl: config.interviewDemoVideoUrl || null,
      interviewDemoVideoTitle: config.interviewDemoVideoTitle || null,
      promoVideoUrl: config.promoVideoUrl || null,
      promoVideoTitle: config.promoVideoTitle || null,
      // Countries the storefront should show in the country switcher, welcome
      // modal, and /country/* pages. Admin-configurable from /admin/settings;
      // defaults to Uganda-only. Never empty — falls back to ['UGANDA'] so
      // the storefront always has at least one selectable country.
      enabledCountries: ['UGANDA'],
      specialFindsEnabled,
      siteName: general.siteName,
      maintenanceMode: general.maintenanceMode,
      allowRegistration: general.allowRegistration,
      maxImagesPerListing: general.maxImagesPerListing,
      itemsPerPage: general.itemsPerPage,
      // Admin → Category layout: order and hiding of top-level categories on buyer surfaces.
      categoryRank: general.categoryRank,
      hiddenCategories: general.hiddenCategories,
      // "Special Offers" (formerly "Special Finds") — replaces the old bare
      // specialFindsEnabled boolean above (kept for backward compatibility)
      // with the full admin-controlled shape: discount threshold + optional
      // scheduled window. Falls back to specialFindsEnabled for `enabled`
      // when the admin hasn't saved this newer form yet — see PUT
      // /admin/site-config/special-offers for the write side of this same
      // fallback.
      specialOffers: (() => {
        const stored = (config.specialOffers as { enabled?: boolean; minDiscountPercent?: number; startAt?: string | null; endAt?: string | null } | null) || {};
        const enabled = stored.enabled !== undefined ? stored.enabled : specialFindsEnabled;
        const minDiscountPercent = typeof stored.minDiscountPercent === 'number' ? stored.minDiscountPercent : 30;
        const withinWindow =
          (!stored.startAt || new Date(stored.startAt).getTime() <= now.getTime()) &&
          (!stored.endAt || new Date(stored.endAt).getTime() >= now.getTime());
        return {
          enabled: enabled && withinWindow,
          minDiscountPercent,
          startAt: stored.startAt || null,
          endAt: stored.endAt || null,
        };
      })(),
      // The admin-set per-listing tier prices (PUT /admin/site-config/tier-pricing).
      // Webstore fees are packages now and are not part of this payload. Powers the pricing selector
      // shown just before "Post Listing" (see frontend/app/listings/create).
      listingTierPricing: (() => {
        const stored = (config.tierPricing as { currency?: string; listingGoldPrice?: number; listingPlatinumPrice?: number; listingTierDurationDays?: number } | null) || {};
        return {
          currency: stored.currency || 'UGX',
          // null = not set by an admin yet; the posting form then does not offer that tier.
          goldPrice: typeof stored.listingGoldPrice === 'number' ? stored.listingGoldPrice : null,
          platinumPrice: typeof stored.listingPlatinumPrice === 'number' ? stored.listingPlatinumPrice : null,
          durationDays: typeof stored.listingTierDurationDays === 'number' ? stored.listingTierDurationDays : null,
        };
      })(),
    });
  } catch {
    res.json({ whatsappNumber: null, todaysDeals: [], logoUrl: null, logoPages: [], logoAltText: null, logoSize: 28, logoLinkUrl: null, logoDisplayMode: 'inline', interviewDemoVideoUrl: null, interviewDemoVideoTitle: null, promoVideoUrl: null, promoVideoTitle: null, enabledCountries: ['UGANDA'], specialFindsEnabled: true, siteName: 'Piitrade', maintenanceMode: false, allowRegistration: true, maxImagesPerListing: 10, itemsPerPage: 20, categoryRank: [], hiddenCategories: [], specialOffers: { enabled: true, minDiscountPercent: 30, startAt: null, endAt: null }, listingTierPricing: { currency: 'UGX', goldPrice: null, platinumPrice: null, durationDays: null } });
  }
});

// 404 handler for unmatched API routes – must come after all route registrations.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ message: 'Not found' });
});

// Error handler
app.use(errorHandler);

export default app;
