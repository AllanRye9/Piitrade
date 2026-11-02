/**
 * Admin → Translations. Mounted at /api/admin/translations (before the main admin router).
 *
 *   GET    /            every stored override: { translations: { [locale]: { [english]: translated } }, total }
 *   PUT    /bulk        { entries: [{ key, locale, value }] } — upsert; a blank value removes that override
 *   DELETE /            ?locale=lg&confirm=RESET — remove every override for one language
 *
 * The file parsing (CSV / Markdown / pasted text) happens in the browser, so the admin sees a preview before
 * anything is sent; this API only validates and stores. Public read side: routes/publicTranslations.ts.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { prisma } from '../utils/prisma';
import { recordAdminAudit } from '../utils/adminAudit';
import { logger } from '../utils/logger';
import { applyEntries, invalidateTranslations, isValidLocale, validateEntries } from '../utils/translations';

const router = Router();
router.use(authenticate, authorize('ADMIN'));

const actorOf = (req: Request) => {
  const u = (req as AuthRequest).user;
  return { actorId: u?.userId ?? null, actorEmail: u?.email ?? null };
};

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.translation.findMany({ select: { locale: true, key: true, value: true } });
    const translations: Record<string, Record<string, string>> = {};
    for (const r of rows) (translations[r.locale] ??= {})[r.key] = r.value;
    res.json({ translations, total: rows.length });
  } catch (err) {
    next(err);
  }
});

router.put('/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entries, errors } = validateEntries(req.body?.entries);
    if (errors.length && !entries.length) throw createError(errors[0], 400);
    const { actorId, actorEmail } = actorOf(req);
    const { saved, removed } = await applyEntries(entries, actorEmail);
    const languages = [...new Set(entries.map((e) => e.locale))];
    recordAdminAudit({ action: 'TRANSLATIONS_UPDATED', actorId, actorEmail, meta: { saved, removed, languages, rejected: errors.length } })
      .catch((err) => logger.error('Could not audit translation update', err));
    res.json({ saved, removed, rejected: errors.length, errors: errors.slice(0, 20) });
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locale = req.query.locale;
    if (!isValidLocale(locale)) throw createError('Choose a language to reset.', 400);
    if (req.query.confirm !== 'RESET') throw createError('Type RESET to confirm removing every custom translation for this language.', 400);
    const { count } = await prisma.translation.deleteMany({ where: { locale } });
    invalidateTranslations();
    const { actorId, actorEmail } = actorOf(req);
    recordAdminAudit({ action: 'TRANSLATIONS_RESET', actorId, actorEmail, meta: { locale, removed: count } })
      .catch((err) => logger.error('Could not audit translation reset', err));
    res.json({ removed: count });
  } catch (err) {
    next(err);
  }
});

export default router;
