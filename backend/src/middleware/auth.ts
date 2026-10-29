import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../utils/jwt';
import { prisma } from '../utils/prisma';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

// ─── Presence (online/offline for the chat UI) ─────────────────────────────
// Touches User.lastActiveAt on authenticated requests so other users can
// see a green "online" dot (see GET /messages/conversations and
// /messages/thread/:userId, which surface it). Throttled per-user to once
// every 60s rather than on every single request — this fires on nearly
// every API call, so writing unconditionally would mean a DB write per
// request across the whole app just for a presence dot. In-memory and
// per-process (like the messages typing-indicator store below it) — on a
// multi-instance deployment each instance throttles independently, so in
// the worst case a user's presence gets touched up to (instance count)
// times as often as intended. Harmless for a "online within ~2 minutes"
// signal; not worth a shared store for this.
const lastTouched = new Map<string, number>();
const PRESENCE_THROTTLE_MS = 60_000;

function touchPresence(userId: string) {
  const now = Date.now();
  const last = lastTouched.get(userId) ?? 0;
  if (now - last < PRESENCE_THROTTLE_MS) return;
  lastTouched.set(userId, now);
  prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } })
    .catch(() => { /* best-effort — a missed presence touch just means a slightly stale dot */ });
}

// ─── Live account status (ban / role / deletion) ────────────────────────────
// A signed access token is valid for up to JWT_EXPIRES_IN (7d by default) and
// carries the role it was issued with. Trusting it alone meant a BANNED user, a
// DELETED user, or an ADMIN who had just been demoted kept full access until the
// token expired — and a banned user could keep minting new tokens because
// /auth/refresh never looked at isBanned. So every authenticated request now
// re-checks the account's current state. The lookup is cached for a few seconds
// per user so the common case is not a DB round-trip per request; admin actions
// that change ban/role call invalidateAccountStatus() to take effect at once on
// this instance (other instances converge within STATUS_TTL_MS).
interface AccountStatus {
  exists: boolean;
  role: string;
  isBanned: boolean;
  fetchedAt: number;
}
const statusCache = new Map<string, AccountStatus>();
const STATUS_TTL_MS = 15_000;
const STATUS_CACHE_MAX = 5_000;

export function invalidateAccountStatus(userId: string): void {
  statusCache.delete(userId);
}

async function getAccountStatus(userId: string): Promise<AccountStatus> {
  const cached = statusCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < STATUS_TTL_MS) return cached;

  const row = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isBanned: true } });
  const status: AccountStatus = row
    ? { exists: true, role: row.role, isBanned: row.isBanned, fetchedAt: Date.now() }
    : { exists: false, role: '', isBanned: false, fetchedAt: Date.now() };

  if (statusCache.size >= STATUS_CACHE_MAX) statusCache.clear(); // simple bound; entries are cheap to refetch
  statusCache.set(userId, status);
  return status;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }
  const token = authHeader.split(' ')[1];

  let decoded: JwtPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }

  try {
    const status = await getAccountStatus(decoded.userId);
    if (!status.exists) {
      res.status(401).json({ message: 'Account no longer exists' });
      return;
    }
    if (status.isBanned) {
      res.status(403).json({ message: 'Account is banned' });
      return;
    }
    // Use the CURRENT role, not the one baked into the token at login time.
    req.user = { ...decoded, role: status.role };
    touchPresence(decoded.userId);
    next();
  } catch (err) {
    next(err); // database trouble -> the error handler's 5xx, never a silent allow
  }
};

export const optionalAuthenticate = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyAccessToken(token);
    const status = await getAccountStatus(decoded.userId);
    // Banned / deleted accounts are simply treated as anonymous on public routes.
    req.user = status.exists && !status.isBanned ? { ...decoded, role: status.role } : undefined;
    if (req.user) touchPresence(decoded.userId);
  } catch {
    req.user = undefined;
  }
  next();
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    next();
  };
};
