import { Request, Response, NextFunction } from 'express';
import { getAllowedOrigins, isAllowedOrigin } from '../utils/corsOrigins';

/**
 * CSRF defence for endpoints that authenticate with the refresh-token COOKIE
 * (POST /auth/refresh, POST /auth/logout).
 *
 * That cookie is SameSite=None (the SPA and API live on different sites), so a
 * browser attaches it to cross-site requests too. Browsers always send an
 * Origin header on cross-site POSTs, so a request whose Origin is present but
 * not on our allow-list is rejected. Requests with no Origin (curl, server to
 * server) are not browser-driven CSRF and are let through.
 */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin || isAllowedOrigin(origin, getAllowedOrigins())) {
    next();
    return;
  }
  res.status(403).json({ message: 'Origin not allowed' });
}
