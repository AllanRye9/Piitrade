import express, { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { logger } from '../utils/logger';
import {
  evaluateVerification, getAppSecret, needsAttention, parseWebhook, verifySignature,
} from '../utils/whatsappWebhook';
import { applyWhatsAppStatuses } from '../utils/whatsappStatus';
import type { ParsedStatus } from '../utils/whatsappWebhook';

/**
 * /api/webhooks/whatsapp — the "Callback URL" and "Verify token" Meta asks for under
 * WhatsApp → Configuration → Webhooks.
 *
 *   GET   verification handshake (answers hub.challenge when hub.verify_token matches WHATSAPP_VERIFY_TOKEN)
 *   POST  delivery receipts, inbound-message notices and account/template events, signed with the app secret
 *
 * Mounted in app.ts BEFORE the global API limiter, JSON parser and maintenance gate: the signature is computed over
 * the raw bytes (so the body must not be parsed first), and Meta must keep getting answers during maintenance.
 */

/** A receipt can reach us a moment before the id of the message it is about has been saved; look once more shortly after. */
export const UNMATCHED_RETRY_MS = 5000;

const asTextOnly = (res: Response, status: number, text: string) => res.status(status).type('text/plain').send(text);

let lastSecretWarning = 0;
function warnMissingSecret(): void {
  const now = Date.now();
  if (now - lastSecretWarning < 60 * 60 * 1000) return;
  lastSecretWarning = now;
  logger.warn('WhatsApp webhook POST rejected: WHATSAPP_APP_SECRET is not set, so the signature cannot be verified. Set it (Meta app → Settings → Basic → App secret).');
}

export function createWhatsAppWebhookRouter(opts: { retryDelayMs?: number } = {}): Router {
  const retryDelayMs = opts.retryDelayMs ?? UNMATCHED_RETRY_MS;
  const router = Router();

  // The verify token is a shared secret: keep guessing slow.
  const verifyLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: 'Too many requests' });
  // Generous: a busy day can legitimately send many receipts, and Meta retries on any non-2xx.
  const eventLimiter = rateLimit({ windowMs: 60 * 1000, max: 1200, standardHeaders: true, legacyHeaders: false, message: 'Too many requests' });

  router.get('/', verifyLimiter, (req: Request, res: Response) => {
    const result = evaluateVerification(req.query as Record<string, unknown>);
    if (result.ok === false) {
      logger.warn(`WhatsApp webhook verification rejected: ${result.reason}`);
      // Never tell the caller whether a token is configured or how it differed.
      return asTextOnly(res, result.status, result.status === 503 ? 'Webhook not configured' : 'Forbidden');
    }
    logger.info('WhatsApp webhook verified by Meta');
    return asTextOnly(res, 200, result.challenge);
  });

  router.post('/', eventLimiter, express.raw({ type: () => true, limit: '1mb' }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const secret = getAppSecret();
      if (!secret) {
        warnMissingSecret();
        return asTextOnly(res, 503, 'Webhook not configured');
      }

      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!verifySignature(raw, req.get('x-hub-signature-256'), secret)) {
        logger.warn('WhatsApp webhook POST rejected: invalid or missing X-Hub-Signature-256');
        return asTextOnly(res, 403, 'Forbidden');
      }

      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return asTextOnly(res, 400, 'Invalid JSON');
      }

      const parsed = parseWebhook(body);

      for (const e of parsed.events) {
        const line = `WhatsApp account event: ${e.field}${e.event ? ` ${e.event}` : ''}${e.detail ? ` (${e.detail})` : ''}`;
        if (needsAttention(e)) logger.warn(`${line} — alerts may be affected; check WhatsApp Manager`);
        else logger.info(line);
      }
      if (parsed.inboundMessages > 0) logger.info(`WhatsApp webhook: ${parsed.inboundMessages} inbound message(s) received (not stored)`);

      // A database error here returns 500 on purpose: Meta then retries, and applying a receipt twice is harmless.
      const applied = await applyWhatsAppStatuses(parsed.statuses);
      if (parsed.statuses.length) {
        logger.info(`WhatsApp webhook: ${parsed.statuses.length} receipt(s), ${applied.matched} matched, ${applied.updated} updated`);
      }
      if (applied.unmatched.length) retryUnmatched(applied.unmatched, retryDelayMs);

      return asTextOnly(res, 200, 'EVENT_RECEIVED');
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function retryUnmatched(statuses: ParsedStatus[], delayMs: number): void {
  const timer = setTimeout(() => {
    applyWhatsAppStatuses(statuses)
      .then((r) => {
        if (r.unmatched.length) logger.info(`WhatsApp webhook: ${r.unmatched.length} receipt(s) matched none of our messages (sent from elsewhere or already pruned)`);
      })
      .catch((err) => logger.warn(`WhatsApp receipt retry failed: ${String(err)}`));
  }, delayMs);
  timer.unref?.();
}

export default createWhatsAppWebhookRouter();
