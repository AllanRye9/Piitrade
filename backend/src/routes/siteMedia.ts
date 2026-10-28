import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';

const router = Router();

/**
 * GET /api/site-media?section=hero
 * Public endpoint: returns active site media items for a given page section.
 * Used by the frontend home page to populate dynamic hero slides, banners, etc.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const section = req.query.section as string | undefined;
    const where: { isActive: boolean; section?: string } = { isActive: true };
    if (section) where.section = section;

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
