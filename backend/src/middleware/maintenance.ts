import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { getGeneralSettings } from '../utils/siteSettings';

// Paths that must keep working during maintenance: signing in (so an admin can
// get back in), the public config the maintenance screen itself reads, and
// health checks.
const EXEMPT_PREFIXES = ['/auth', '/admin', '/public/site-config', '/users/me'];

/**
 * When Admin → Settings → Maintenance Mode is on, every API call except the
 * exempt ones above (and any call carrying an ADMIN token) gets a 503 with
 * `maintenance: true`, which the storefront turns into a maintenance screen.
 * Mounted on /api, so `req.path` here is relative to it.
 */
export async function maintenanceGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await getGeneralSettings();
    if (!settings.maintenanceMode) return next();
    if (req.method === 'OPTIONS') return next();
    if (EXEMPT_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();

    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        if (verifyAccessToken(header.split(' ')[1]).role === 'ADMIN') return next();
      } catch { /* fall through to 503 */ }
    }
    res.status(503).json({ message: 'The site is undergoing maintenance. Please check back shortly.', maintenance: true });
  } catch {
    next();
  }
}
