import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { getCategoryCounts } from '../utils/categoryCounts';
import { DEFAULT_CATEGORIES, SUBCATEGORY_MAP, fieldsFor } from '../utils/categoryTaxonomy';

const router = Router();


/**
 * Make sure every category in the built-in tree exists. Purely additive: existing rows (renamed, re-iconed,
 * given custom fields by an admin, or deliberately deleted subcategories' parents) are never touched, and a
 * slug that already exists anywhere is left alone. Runs once per server process.
 */
async function syncTaxonomy(): Promise<void> {
  const existing = await prisma.category.findMany({ select: { id: true, slug: true } });
  const idBySlug = new Map<string, string>(existing.map((c) => [String(c.slug), String(c.id)] as [string, string]));
  const missingParents = DEFAULT_CATEGORIES.filter((c) => !idBySlug.has(c.slug));
  if (missingParents.length) {
    await prisma.category.createMany({ data: missingParents, skipDuplicates: true });
    const fresh = await prisma.category.findMany({ where: { slug: { in: missingParents.map((c) => c.slug) } }, select: { id: true, slug: true } });
    for (const c of fresh) idBySlug.set(String(c.slug), String(c.id));
  }
  const missingSubs: { name: string; slug: string; icon: string; parentId: string }[] = [];
  for (const parent of DEFAULT_CATEGORIES) {
    const parentId = idBySlug.get(parent.slug);
    if (!parentId) continue;
    for (const sub of SUBCATEGORY_MAP[parent.slug] ?? []) {
      if (!idBySlug.has(sub.slug)) missingSubs.push({ ...sub, parentId });
    }
  }
  if (missingSubs.length) await prisma.category.createMany({ data: missingSubs, skipDuplicates: true });
}

// Public category tree: only active categories, ordered by the admin's sortOrder and then name.
// sortOrder defaults to 0 everywhere, so until an admin reorders anything this is the same
// alphabetical order the API always returned. Retired categories (isActive = false) are hidden here
// and are not offered for new listings; existing listings keep their category.
const CATEGORY_ORDER = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];
const publicTreeQuery = {
  where: { parentId: null, isActive: true },
  include: { children: { where: { isActive: true }, orderBy: CATEGORY_ORDER } },
  orderBy: CATEGORY_ORDER,
};


// Track whether we've already seeded so we skip on subsequent requests.
let seeded = false;

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!seeded) {
      await syncTaxonomy();
      seeded = true;
    }
    const categories = await prisma.category.findMany(publicTreeQuery);

    // Category tree changes rarely (admin action only) but is fetched on
    // essentially every page load (nav mega-menu), so it's the single
    // highest-value endpoint on the site to cache — same convention used
    // for /site-config and the pricing feeds.
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
    // The form each kind of ad asks for: an admin-defined schema wins, otherwise the built-in set for
    // that subcategory, else for its parent (see utils/categoryTaxonomy.ts). Sent already resolved so the
    // ad form and the server's validation read the same list.
    res.json(categories.map((c) => ({
      ...c,
      fieldSchema: fieldsFor(c.slug, null, c.fieldSchema),
      children: c.children.map((k) => ({ ...k, fieldSchema: fieldsFor(k.slug, c.slug, k.fieldSchema) })),
    })));
  } catch (err) {
    next(err);
  }
});

// ─── Live category counts ─────────────────────────────────────────────────────
// All three endpoints below are views over ONE computation (utils/categoryCounts.ts), so the
// numbers can never disagree between the nav, the home page and a category page. It counts
// exactly what a visitor can see (ACTIVE and not past expiresAt) and is invalidated the moment a
// listing changes; a 5s TTL + shared in-flight query covers other instances.
//
//   GET /api/categories/counts         everything: counts (rolled up), direct, new24h, total
//   GET /api/categories/rollup-counts  { counts, total, country }   (home page icons — unchanged shape)
//   GET /api/categories/active-counts  { counts: <direct per slug>, country }  (hide empty subcategories — unchanged shape)
//
// A category with nothing live has no key: treat a missing key as 0. `counts.jobs` is the number
// of open JobPost rows, because the Jobs page is backed by that model.
const PUBLIC_COUNT_COUNTRIES = ['UGANDA'] as const;

function scopedCountry(raw: unknown): string | null {
  return typeof raw === 'string' && (PUBLIC_COUNT_COUNTRIES as readonly string[]).includes(raw) ? raw : null;
}

// Short browser/CDN cache, but revalidation is always allowed so a client can poll cheaply with
// If-None-Match and get 304 until a number actually changes.
const COUNTS_CACHE_CONTROL = 'public, max-age=5, stale-while-revalidate=15';

router.get('/counts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getCategoryCounts(scopedCountry(req.query.country));
    res.set('Cache-Control', COUNTS_CACHE_CONTROL);
    res.set('ETag', result.etag);
    if (req.headers['if-none-match'] === result.etag) {
      res.status(304).end();
      return;
    }
    const { etag: _etag, ...body } = result;
    res.json(body);
  } catch (err) {
    next(err);
  }
});

router.get('/rollup-counts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getCategoryCounts(scopedCountry(req.query.country));
    res.set('Cache-Control', COUNTS_CACHE_CONTROL);
    res.json({ counts: result.counts, total: result.total, country: result.country });
  } catch (err) {
    next(err);
  }
});

router.get('/active-counts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getCategoryCounts(scopedCountry(req.query.country));
    res.set('Cache-Control', COUNTS_CACHE_CONTROL);
    res.json({ counts: result.direct, country: result.country });
  } catch (err) {
    next(err);
  }
});

// GET /api/categories/by-slug/:slug — one category (top-level OR subcategory) with what a generic
// category page needs: its parent (breadcrumb), its active subcategories in display order (with
// shortName / menuGroup), and its active siblings. 404 for unknown or retired categories.
router.get('/by-slug/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      res.status(404).json({ message: 'Category not found' });
      return;
    }
    const category = await prisma.category.findUnique({
      where: { slug },
      include: {
        parent: { select: { id: true, name: true, slug: true, icon: true, shortName: true, isActive: true } },
        children: { where: { isActive: true }, orderBy: CATEGORY_ORDER },
      },
    });
    if (!category || !category.isActive || (category.parent && !category.parent.isActive)) {
      res.status(404).json({ message: 'Category not found' });
      return;
    }
    const siblings = category.parentId
      ? await prisma.category.findMany({
          where: { parentId: category.parentId, isActive: true, id: { not: category.id } },
          orderBy: CATEGORY_ORDER,
          select: { id: true, name: true, slug: true, icon: true, shortName: true },
        })
      : [];
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
    res.json({ category, parent: category.parent, children: category.children, siblings });
  } catch (err) {
    next(err);
  }
});


router.get('/:slug/subcategories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let parent = await prisma.category.findUnique({ where: { slug: req.params.slug } });

    // Self-healing fallback: the usual place a missing top-level category
    // gets created is the reconciliation loop in GET / above, but that
    // only ever runs once per server process (see the module-level
    // `seeded` flag) and only as a side effect of someone hitting GET /
    // first. A fresh deploy, a server instance that hasn't served that
    // route yet, or a category added to DEFAULT_CATEGORIES after the
    // process last ran that reconciliation can all leave a known category
    // (e.g. "agriculture") missing here even though it's expected to
    // exist — which is exactly what surfaced as "Could not load produce
    // categories" on /listings/create-produce. Rather than depend on that
    // side effect's timing, create it on demand here too, but only for a
    // slug we actually recognise (DEFAULT_CATEGORIES) — an arbitrary/typo'd
    // slug in the URL still correctly 404s below.
    if (!parent) {
      const known = DEFAULT_CATEGORIES.find((c) => c.slug === req.params.slug);
      if (known) {
        parent = await prisma.category.upsert({
          where: { slug: known.slug },
          update: {},
          create: known,
        });
        const subs = SUBCATEGORY_MAP[known.slug] || [];
        for (const sub of subs) {
          await prisma.category.upsert({
            where: { slug: sub.slug },
            update: {},
            create: { ...sub, parentId: parent.id },
          });
        }
      }
    }

    if (!parent) {
      res.status(404).json({ message: 'Category not found' });
      return;
    }
    const subcategories = await prisma.category.findMany({
      where: { parentId: parent.id, isActive: true },
      orderBy: CATEGORY_ORDER,
    });
    res.json(subcategories);
  } catch (err) {
    next(err);
  }
});

export default router;
