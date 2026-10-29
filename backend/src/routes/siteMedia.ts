import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';

const router = Router();

/** Sections with one dedicated job each. They are never mixed into a general, section-less listing. */
const SINGLE_PURPOSE_SECTIONS = ['brand-logo', 'sticky-header'] as const;

/**
 * GET /api/site-media?section=hero
 * Public endpoint: returns active site media items for a given page section.
 * Used by the frontend home page to populate dynamic hero slides, banners, etc.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const section = req.query.section as string | undefined;
    const where: { isActive: boolean; section?: string | { notIn: string[] } } = { isActive: true };
    // A request for one section gets exactly that section. A request with no section (the home page does
    // this) must never receive the Site Logo or the Promo Header Banner: each has its own dedicated
    // consumer and is only served when asked for by name.
    if (section) where.section = section;
    else where.section = { notIn: [...SINGLE_PURPOSE_SECTIONS] };

    // The Site Logo and Promo Banner must reflect an admin change at once: browsers/CDNs may store them but must
    // revalidate every time (cheap 304 via ETag) instead of reusing a copy for up to 15 s.
    if (section && (SINGLE_PURPOSE_SECTIONS as readonly string[]).includes(section)) res.setHeader('Cache-Control', 'no-cache');

    const media = await prisma.siteMedia.findMany({
      where,
      orderBy: section === 'brand-logo'
        ? [{ createdAt: 'desc' }, { sortOrder: 'desc' }]
        : [{ section: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        section: true,
        cdnUrl: true,
        title: true,
        shortDescription: true,
        price: true,
        originalPrice: true,
        currency: true,
        altText: true,
        linkUrl: true,
        sortOrder: true,
      },
    });

    // The Promo Header Banner must never carry the Site Logo: drop any banner row that points at the logo's file.
    if (section === 'sticky-header') {
      const logos = await prisma.siteMedia.findMany({ where: { isActive: true, section: 'brand-logo' }, select: { cdnUrl: true } });
      const logoUrls = new Set(logos.map((l) => l.cdnUrl));
      return res.json({ media: media.filter((m) => !logoUrls.has(m.cdnUrl)) });
    }

    res.json({ media });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/site-media/social-links
 * Public endpoint: returns admin-configured social media links for the footer.
 */
router.get('/social-links', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const links = await prisma.socialLinks.findUnique({ where: { id: 'global' } });
    res.json(links || { facebook: null, instagram: null, linkedin: null, x: null, whatsapp: null, youtube: null, tiktok: null });
  } catch (err) {
    next(err);
  }
});

export default router;
