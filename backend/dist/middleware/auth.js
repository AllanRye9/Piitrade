"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorize = exports.optionalAuthenticate = exports.authenticate = void 0;
const jwt_1 = require("../utils/jwt");
const prisma_1 = require("../utils/prisma");
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
const lastTouched = new Map();
const PRESENCE_THROTTLE_MS = 60000;
function touchPresence(userId) {
    const now = Date.now();
    const last = lastTouched.get(userId) ?? 0;
    if (now - last < PRESENCE_THROTTLE_MS)
        return;
    lastTouched.set(userId, now);
    prisma_1.prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } })
        .catch(() => { });
}
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ message: 'No token provided' });
        return;
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = (0, jwt_1.verifyAccessToken)(token);
        req.user = decoded;
        touchPresence(decoded.userId);
        next();
    }
    catch {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
};
exports.authenticate = authenticate;
const optionalAuthenticate = (req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        next();
        return;
    }
    const token = authHeader.split(' ')[1];
    try {
        req.user = (0, jwt_1.verifyAccessToken)(token);
        touchPresence(req.user.userId);
    }
    catch {
        req.user = undefined;
    }
    next();
};
exports.optionalAuthenticate = optionalAuthenticate;
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            res.status(403).json({ message: 'Insufficient permissions' });
            return;
        }
        next();
    };
};
exports.authorize = authorize;
//# sourceMappingURL=auth.js.map