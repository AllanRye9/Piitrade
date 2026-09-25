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

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    touchPresence(decoded.userId);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export const optionalAuthenticate = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = verifyAccessToken(token);
    touchPresence(req.user.userId);
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
