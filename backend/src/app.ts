import express, { Request, Response } from 'express';
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
import categoryRoutes from './routes/categories';
import reportRoutes from './routes/reports';
import reviewRoutes from './routes/reviews';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/upload';
import statsRoutes from './routes/stats';
import docRoutes from './routes/doc';
import cartRoutes from './routes/cart';
import addressRoutes from './routes/addresses';
import orderRoutes from './routes/orders';
import couponRoutes from './routes/coupons';
import notificationRoutes from './routes/notifications';
import storeRoutes from './routes/stores';
import withdrawalRoutes from './routes/withdrawals';
import packageRoutes from './routes/packages';
import imagesRoutes from './routes/images';
import siteMediaRoutes from './routes/siteMedia';
import blogRoutes from './routes/blog';
import storeRentalRoutes from './routes/storeRentals';
import cvServiceRequestRoutes from './routes/cvServiceRequests';
import cvPaymentRoutes from './routes/cvPayment';
import jobRoutes from './routes/jobs';
import currencyRatesRoutes from './routes/currencyRates';
import { getServiceReadiness } from './utils/serviceConfig';

const app = express();

// Trust the first reverse-proxy hop (Railway, Render, nginx, etc.) so that
// express-rate-limit (and req.ip) use the real client IP from X-Forwarded-For
// instead of the proxy's IP.  Without this, express-rate-limit v7+ throws a
// ValidationError when X-Forwarded-For is present but trust proxy is false.
app.set('trust proxy', 1);

// Support a comma-separated list of allowed origins in CORS_ORIGIN so that
// multiple deployment URLs (e.g. Railway + Render + Vercel) can be whitelisted
// without requiring code changes.  The live public site and the Railway-hosted
// backend are separate hosts, so allow both the known production domains and
// wildcard subdomains used by hosting platforms.
//
// Important: CORS_ORIGIN may be set to a local-only value in development, but
// the production frontend (piitrade.com / www.piitrade.com) must remain allowed
// even then. Merge the configured origins with the default public hosts rather
// than replacing the allowlist entirely.
const defaultCorsOrigins = ['http://localhost:3000', 'https://piitrade.com', 'https://www.piitrade.com'];
const rawCorsOrigins = process.env.CORS_ORIGIN || defaultCorsOrigins.join(',');
const allowedOrigins = Array.from(new Set([
  ...defaultCorsOrigins,
  ...rawCorsOrigins.split(',').map((o) => o.trim()).filter(Boolean),
]));

const normalizeOrigin = (value: string): string => value.replace(/\/+$/, '');
const matchesAllowedOrigin = (origin: string): boolean => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(normalizedOrigin)) return true;

  return allowedOrigins.some((allowedOrigin) => {
    if (!allowedOrigin.includes('*')) return false;
    const regex = new RegExp(
      `^${allowedOrigin
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*')}$`
    );
    return regex.test(normalizedOrigin);
  }) || /^https:\/\/([a-z0-9-]+\.)*up\.railway\.app$/.test(normalizedOrigin)
    || /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/.test(normalizedOrigin);
};

// CORS must be registered before helmet so that CORS response headers
// (Access-Control-Allow-Origin, etc.) are present on every response –
// including preflight OPTIONS replies – before helmet adds its own
// restrictive Cross-Origin-* headers.
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. server-to-server, curl, Postman)
    if (!origin) return callback(null, true);
    // When the wildcard '*' is in the allowed list, reflect the requesting
    // origin back. A literal '*' cannot be used with credentials:true, so
    // we must echo the origin instead.
    if (matchesAllowedOrigin(origin)) return callback(null, true);
    // Failed CORS checks are noisy in production; keep the browser error but do
    // not crash the request path itself.
    logger.warn(`Blocked CORS request from origin: ${origin}`);
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

app.get('/health/services', (_req: Request, res: Response) => {
  const readiness = getServiceReadiness();
  const status = readiness.jwt.ready ? 200 : 503;
  res.status(status).json({
    status: readiness.jwt.ready ? 'ok' : 'error',
    services: readiness,
  });
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

// Strict limiter for auth mutation endpoints (login / register) to prevent
// brute-force and credential-stuffing attacks while keeping normal use smooth.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,       // 15 minutes
  max: 20,                          // 20 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait a few minutes before trying again.' },
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
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// Logging
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) },
}));

// User documents (CVs, certificates, ID uploads — some marked private) are
// stored under uploads/documents/ when running on the local-filesystem
// fallback. Block that prefix from the plain static mount below — it has no
// concept of auth/ownership at all — so those files are only reachable
// through the authenticated GET /api/upload/documents/:id/file route, which
// checks ownership/visibility before streaming anything. This must be
// registered before the general static mount so it takes precedence.
app.use('/uploads/documents', (_req: Request, res: Response) => {
  res.status(403).json({ message: 'Not accessible directly' });
});

// Serve uploaded images as static files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/admin-register', authLimiter);
app.use('/api/users/me', meLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/doc', docRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/site-media', siteMediaRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/store-rentals', storeRentalRoutes);
app.use('/api/cv-service-requests', cvServiceRequestRoutes);
app.use('/api/cv-payment', cvPaymentRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/currency-rates', currencyRatesRoutes);

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
      headerTheme: config.headerTheme || null,
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
      adImages: Array.isArray(config.adImages) ? config.adImages : [],
      adIntervalSeconds: config.adIntervalSeconds || 5,
    });
  } catch {
    res.json({ whatsappNumber: null, todaysDeals: [], headerTheme: null, logoUrl: null, logoPages: [], logoAltText: null, logoSize: 28, logoLinkUrl: null, logoDisplayMode: 'inline', interviewDemoVideoUrl: null, interviewDemoVideoTitle: null, promoVideoUrl: null, promoVideoTitle: null, adImages: [], adIntervalSeconds: 5 });
  }
});

// 404 handler for unmatched API routes – must come after all route registrations.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ message: 'Not found' });
});

// Error handler
app.use(errorHandler);

export default app;
