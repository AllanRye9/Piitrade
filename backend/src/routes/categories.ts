import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { getCategoryCounts } from '../utils/categoryCounts';

const router = Router();

// Default categories matching the frontend CategoryBar structure.
const DEFAULT_CATEGORIES = [
  { name: 'Motors', slug: 'motors', icon: '🚗' },
  { name: 'Property', slug: 'property', icon: '🏠' },
  { name: 'Jobs', slug: 'jobs', icon: '💼' },
  { name: 'CV Services', slug: 'cv-services', icon: '📄' },
  { name: 'Classifieds', slug: 'classifieds', icon: '📋' },
  { name: 'Electronics', slug: 'electronics', icon: '💻' },
  { name: 'Fashion', slug: 'fashion', icon: '👗' },
  { name: 'Furniture & Garden', slug: 'furniture', icon: '🛋️' },
  { name: 'Services', slug: 'services', icon: '🔧' },
  { name: 'Agriculture', slug: 'agriculture', icon: '🌾' },
];

const SUBCATEGORY_MAP: Record<string, { name: string; slug: string; icon: string }[]> = {
  motors: [
    { name: 'Used Cars', slug: 'used-cars', icon: '🚙' },
    { name: 'New Cars', slug: 'new-cars', icon: '🏎️' },
    { name: 'Classic Cars', slug: 'classic-cars', icon: '🚕' },
    { name: 'Motorcycles', slug: 'motorcycles', icon: '🏍️' },
    { name: 'Trucks & Buses', slug: 'trucks-buses', icon: '🚛' },
    { name: 'Boats', slug: 'boats', icon: '⛵' },
    { name: 'Car Parts', slug: 'car-parts', icon: '⚙️' },
    { name: 'Tyres & Wheels', slug: 'tyres-wheels', icon: '🛞' },
    { name: 'Car Accessories', slug: 'car-accessories', icon: '🪄' },
  ],
  property: [
    { name: 'Apartments for Rent', slug: 'apartments-rent', icon: '🏢' },
    { name: 'Houses for Rent', slug: 'houses-rent', icon: '🏠' },
    { name: 'Rooms for Rent', slug: 'rooms-rent', icon: '🛏️' },
    { name: 'Apartments for Sale', slug: 'apartments-sale', icon: '🏗️' },
    { name: 'Houses for Sale', slug: 'houses-sale', icon: '🏡' },
    { name: 'Land & Plots', slug: 'land-plots', icon: '🗺️' },
    { name: 'Office Space', slug: 'office-space', icon: '🏢' },
    { name: 'Shops & Retail', slug: 'shops-retail', icon: '🏪' },
    { name: 'Warehouses', slug: 'warehouses', icon: '🏭' },
  ],
  jobs: [
    { name: 'Full Time', slug: 'full-time', icon: '💼' },
    { name: 'Part Time', slug: 'part-time', icon: '🕐' },
    { name: 'Freelance', slug: 'freelance', icon: '💻' },
    { name: 'Technology', slug: 'technology', icon: '🖥️' },
    { name: 'Healthcare', slug: 'healthcare', icon: '🏥' },
    { name: 'Finance', slug: 'finance', icon: '💰' },
  ],
  'cv-services': [
    { name: 'CV Writing', slug: 'cv-writing', icon: '✍️' },
    { name: 'Resume Templates', slug: 'resume-templates', icon: '📐' },
    { name: 'LinkedIn Optimization', slug: 'linkedin-optimization', icon: '🔗' },
    { name: 'Career Coaching', slug: 'career-coaching', icon: '🧑‍🏫' },
    { name: 'Interview Preparation', slug: 'interview-preparation', icon: '🎤' },
    { name: 'Cover Letters', slug: 'cover-letters', icon: '📝' },
  ],
  classifieds: [
    { name: 'Furniture', slug: 'furniture-classifieds', icon: '🛋️' },
    { name: 'Appliances', slug: 'appliances', icon: '🏠' },
    { name: 'Tools & Garden', slug: 'tools-garden', icon: '🔧' },
    { name: 'Kids & Baby', slug: 'kids-baby', icon: '🧒' },
    { name: 'Sports & Outdoors', slug: 'sports-outdoors', icon: '⚽' },
    { name: 'Books & Hobbies', slug: 'books-hobbies', icon: '📚' },
  ],
  electronics: [
    { name: 'Laptops', slug: 'laptops', icon: '💻' },
    { name: 'Desktops & Monitors', slug: 'desktops', icon: '🖥️' },
    { name: 'Tablets', slug: 'tablets', icon: '📱' },
    { name: 'Smartphones', slug: 'smartphones', icon: '📱' },
    { name: 'Headphones', slug: 'headphones', icon: '🎧' },
    { name: 'Cameras', slug: 'cameras', icon: '📷' },
    { name: 'Consoles', slug: 'consoles', icon: '🎮' },
    { name: 'Games & Accessories', slug: 'games-accessories', icon: '🕹️' },
  ],
  fashion: [
    { name: "Women's Clothing", slug: 'women-clothing', icon: '👗' },
    { name: "Women's Shoes", slug: 'women-shoes', icon: '👠' },
    { name: 'Bags & Accessories', slug: 'women-bags', icon: '👜' },
    { name: "Men's Clothing", slug: 'men-clothing', icon: '👔' },
    { name: "Men's Shoes", slug: 'men-shoes', icon: '👞' },
    { name: 'Watches', slug: 'watches', icon: '⌚' },
    { name: "Girls' Clothing", slug: 'girls-clothing', icon: '👧' },
    { name: "Boys' Clothing", slug: 'boys-clothing', icon: '👦' },
  ],
  furniture: [
    { name: 'Living Room', slug: 'living-room', icon: '🛋️' },
    { name: 'Bedroom', slug: 'bedroom', icon: '🛏️' },
    { name: 'Kitchen & Dining', slug: 'kitchen-dining', icon: '🍳' },
    { name: 'Garden Furniture', slug: 'garden-furniture', icon: '🪴' },
    { name: 'BBQ & Grills', slug: 'bbq-grills', icon: '🔥' },
    { name: 'Plants & Seeds', slug: 'plants-seeds', icon: '🌱' },
  ],
  services: [
    { name: 'Cleaning', slug: 'cleaning', icon: '🧹' },
    { name: 'Plumbing & Electrical', slug: 'plumbing-electrical', icon: '🔌' },
    { name: 'Movers & Storage', slug: 'movers-storage', icon: '📦' },
    { name: 'Tutoring', slug: 'tutoring', icon: '📖' },
    { name: 'Design & Creative', slug: 'design-creative', icon: '🎨' },
    { name: 'IT & Tech Support', slug: 'it-tech-support', icon: '💻' },
  ],
  agriculture: [
    { name: 'Crops & Grains', slug: 'crops-grains', icon: '🌽' },
    { name: 'Fruits & Vegetables', slug: 'fruits-vegetables', icon: '🍅' },
    { name: 'Livestock', slug: 'livestock', icon: '🐄' },
    { name: 'Poultry & Eggs', slug: 'poultry-eggs', icon: '🐔' },
    { name: 'Dairy Products', slug: 'dairy-products', icon: '🥛' },
    { name: 'Seeds & Inputs', slug: 'seeds-inputs', icon: '🌱' },
    { name: 'Farm Equipment', slug: 'farm-equipment', icon: '🚜' },
  ],
};

// Track whether we've already seeded so we skip on subsequent requests.
let seeded = false;

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let categories = await prisma.category.findMany({
      where: { parentId: null },
      include: { children: true },
      orderBy: { name: 'asc' },
    });

    if (!seeded) {
      // Auto-seed default categories if the table is empty so the "create listing"
      // page always has categories to show even before an admin seeds the database.
      if (categories.length === 0) {
        for (const cat of DEFAULT_CATEGORIES) {
          const parent = await prisma.category.upsert({
            where: { slug: cat.slug },
            update: {},
            create: cat,
          });
          const subs = SUBCATEGORY_MAP[cat.slug] || [];
          for (const sub of subs) {
            await prisma.category.upsert({
              where: { slug: sub.slug },
              update: {},
              create: { ...sub, parentId: parent.id },
            });
          }
        }
        categories = await prisma.category.findMany({
          where: { parentId: null },
          include: { children: true },
          orderBy: { name: 'asc' },
        });
      } else {
        // Ensure all expected parent categories exist (add any missing ones).
        for (const cat of DEFAULT_CATEGORIES) {
          const existing = categories.find((c) => c.slug === cat.slug);
          let parentId: string | undefined = existing?.id;
          if (!existing) {
            const created = await prisma.category.upsert({
              where: { slug: cat.slug },
              update: {},
              create: cat,
            });
            parentId = created.id;
          }
          // Ensure subcategories exist for this parent.
          if (parentId && (existing?.children?.length ?? 0) === 0) {
            const subs = SUBCATEGORY_MAP[cat.slug] || [];
            for (const sub of subs) {
              await prisma.category.upsert({
                where: { slug: sub.slug },
                update: {},
                create: { ...sub, parentId },
              });
            }
          }
        }
        categories = await prisma.category.findMany({
          where: { parentId: null },
          include: { children: true },
          orderBy: { name: 'asc' },
        });
      }

      seeded = true;
    }

    // Category tree changes rarely (admin action only) but is fetched on
    // essentially every page load (nav mega-menu), so it's the single
    // highest-value endpoint on the site to cache — same convention used
    // for /site-config and the pricing feeds.
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
    res.json(categories);
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
      where: { parentId: parent.id },
      orderBy: { name: 'asc' },
    });
    res.json(subcategories);
  } catch (err) {
    next(err);
  }
});

export default router;
