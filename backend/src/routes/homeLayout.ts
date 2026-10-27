/**
 * GET /api/home-layout — public. Which homepage sections to show, in what order, plus the ads for every
 * admin-made collection row. One small cached response (30s) so the home page needs a single extra request.
 * The layout itself is edited under Admin → Homepage Layout (see routes/admin.ts, /home-layout/config).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { normalizeHomeLayout, CustomCollection, HomeLayout } from '../utils/homeLayout';

const router = Router();
const TTL_MS = 30_000;
let cache: { at: number; body: unknown } | null = null;

export function invalidateHomeLayoutCache(): void { cache = null; }

export async function loadHomeLayout(): Promise<HomeLayout> {
  const config = await prisma.siteConfig.findUnique({ where: { id: 'global' } });
  return normalizeHomeLayout((config as { homeLayout?: unknown } | null)?.homeLayout);
}

const listingInclude = {
  category: { select: { id: true, name: true, slug: true } },
  user: { select: { id: true, name: true, avatar: true, isKycVerified: true } },
  productImages: { select: { id: true, cdnUrl: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' as const }, take: 1 },
};

async function listingsFor(c: CustomCollection) {
  const now = new Date();
  const visible = { status: 'ACTIVE' as const, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  if (c.source.type === 'listings') {
    if (c.source.ids.length === 0) return [];
    const rows = await prisma.listing.findMany({ where: { id: { in: c.source.ids }, ...visible }, include: listingInclude });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return c.source.ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).slice(0, c.limit);
  }
  if (c.source.type === 'placement') {
    return prisma.listing.findMany({
      where: { ...visible, placement: c.source.placement, placementExpiresAt: { gt: now } },
      include: listingInclude,
      orderBy: [{ pinOrder: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: c.limit,
    });
  }
  const slug = c.source.slug;
  return prisma.listing.findMany({
    where: { ...visible, OR: [{ category: { slug } }, { category: { parent: { slug } } }] },
    include: listingInclude,
    orderBy: [{ pinOrder: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: c.limit,
  });
}

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    if (cache && Date.now() - cache.at < TTL_MS) return res.json(cache.body);
    const layout = await loadHomeLayout();
    const collections = await Promise.all(
      layout.collections.filter((c) => c.enabled && layout.order.includes(`custom:${c.id}`)).map(async (c) => ({
        id: c.id, title: c.title, subtitle: c.subtitle, icon: c.icon, source: c.source, listings: await listingsFor(c),
      })),
    );
    const body = { order: layout.order, settings: layout.settings, collections: collections.filter((c) => c.listings.length > 0) };
    cache = { at: Date.now(), body };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

export default router;
