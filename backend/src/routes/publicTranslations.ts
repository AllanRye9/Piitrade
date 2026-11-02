/**
 * GET /api/public/translations?locale=lg → { locale, version, strings: { "<English>": "<translated>" } }
 * Public (the site reads it on every page); contains only visitor-facing text, nothing private.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createError } from '../middleware/errorHandler';
import { getTranslationMap, isValidLocale } from '../utils/translations';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locale = req.query.locale;
    // English is the source text: nothing to override.
    if (locale === 'en') return void res.json({ locale: 'en', version: '0', strings: {} });
    if (!isValidLocale(locale)) throw createError('A valid language code is required (e.g. ?locale=lg).', 400);
    const { map, version } = await getTranslationMap(locale);
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json({ locale, version, strings: map });
  } catch (err) {
    next(err);
  }
});

export default router;
