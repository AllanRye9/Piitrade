import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { addLiveClient, type LiveTopic } from '../utils/liveHub';

/**
 * /api/live — Server-Sent Events that say WHEN data changed (never the data itself).
 *   GET /public   topic: listings            anyone (search results, listing pages)
 *   GET /admin    topics: listings, clicks   admin only (Item Clicks, moderation views)
 * The browser reacts by quietly re-reading through the normal API, which enforces permissions.
 */
const router = Router();

const STREAM_MAX_AGE_MS = 30 * 60_000; // the client reconnects (and re-authenticates) every 30 min
const HEARTBEAT_MS = 25_000;

function openStream(req: AuthRequest, res: Response, topics: LiveTopic[], key: string): void {
  const remove = addLiveClient(res, topics, key);
  if (!remove) {
    // At capacity: the browser falls back to slow polling.
    res.status(429).json({ message: 'Live updates are busy; falling back to periodic refresh.' });
    return;
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\nevent: hello\ndata: {}\n\n');
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
  const maxAge = setTimeout(() => { try { res.end(); } catch { /* closed */ } }, STREAM_MAX_AGE_MS);
  heartbeat.unref?.();
  maxAge.unref?.();
  const cleanup = () => { clearInterval(heartbeat); clearTimeout(maxAge); remove(); };
  req.on('close', cleanup);
  res.on('error', cleanup);
}

router.get('/public', (req: AuthRequest, res: Response) => {
  openStream(req, res, ['listings'], `ip:${req.ip}`);
});

router.get('/admin', authenticate, authorize('ADMIN'), (req: AuthRequest, res: Response) => {
  openStream(req, res, ['listings', 'clicks'], `u:${req.user!.userId}`);
});

export default router;
