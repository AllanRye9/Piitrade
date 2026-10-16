import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { sanitizeBlogHtml } from '../utils/sanitizeHtml';
import { createError } from '../middleware/errorHandler';

const router = Router();

// ─── Public routes ─────────────────────────────────────────────────────────────

// GET /api/blog/popup — resolved homepage popup config for the public site.
// Reads SiteConfig.blogPopup ({ enabled, intervalSeconds, postId }) and
// resolves it down to a single ready-to-render post:
//   - feature off, or no published posts exist at all → { enabled: false }
//   - a pinned postId that is still PUBLISHED → that post
//   - otherwise → the most recently published post
// Mounted before the `/:slug` route below so "popup" is never swallowed as
// a slug lookup.
router.get('/popup', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.siteConfig.findUnique({ where: { id: 'global' } });
    const stored = (config?.blogPopup as { enabled?: boolean; intervalSeconds?: number; postId?: string | null }) || {};
    const intervalSeconds = typeof stored.intervalSeconds === 'number' && stored.intervalSeconds > 0 ? stored.intervalSeconds : 60;

    if (!stored.enabled) {
      res.json({ enabled: false });
      return;
    }

    const postSelect = {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      featuredImage: true,
      publishedAt: true,
    } as const;

    let post = stored.postId
      ? await prisma.blogPost.findFirst({ where: { id: stored.postId, status: 'PUBLISHED' }, select: postSelect })
      : null;

    if (!post) {
      post = await prisma.blogPost.findFirst({
        where: { status: 'PUBLISHED' },
        select: postSelect,
        orderBy: { publishedAt: 'desc' },
      });
    }

    if (!post) {
      // Admin has the popup switched on but there's nothing publishable to
      // show — fail closed rather than surface an empty popup.
      res.json({ enabled: false });
      return;
    }

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({ enabled: true, intervalSeconds, post });
  } catch (err) {
    next(err);
  }
});

// GET /api/blog — list published posts (paginated)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string || '10')));
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where: { status: 'PUBLISHED' },
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          featuredImage: true,
          publishedAt: true,
          createdAt: true,
          author: { select: { id: true, name: true, avatar: true } },
        },
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.blogPost.count({ where: { status: 'PUBLISHED' } }),
    ]);

    res.json({ posts: posts.map((p) => ('content' in p ? { ...p, content: sanitizeBlogHtml((p as { content?: string }).content) } : p)), total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/blog/:slug — get a single published post
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const post = await prisma.blogPost.findFirst({
      where: { slug: req.params.slug, status: 'PUBLISHED' },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });

    if (!post) return next(createError('Post not found', 404));
    // Sanitised on read as well as on write so posts stored before this fix are covered too.
    res.json({ post: { ...post, content: sanitizeBlogHtml(post.content) } });
  } catch (err) {
    next(err);
  }
});

// ─── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/blog/admin/all — list all posts (draft + published)
router.get('/admin/all', authenticate, authorize('ADMIN'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const posts = await prisma.blogPost.findMany({
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ posts });
  } catch (err) {
    next(err);
  }
});

// GET /api/blog/admin/:id — get a single post by id (admin)
router.get('/admin/:id', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const post = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!post) return next(createError('Post not found', 404));
    res.json({ post });
  } catch (err) {
    next(err);
  }
});

// POST /api/blog — create a new post
router.post('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, slug, content, excerpt, featuredImage, status } = req.body;
    if (!title || !slug || !content) {
      return next(createError('title, slug, and content are required', 400));
    }

    const existing = await prisma.blogPost.findUnique({ where: { slug } });
    if (existing) return next(createError('A post with this slug already exists', 400));

    const post = await prisma.blogPost.create({
      data: {
        title,
        slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        content: sanitizeBlogHtml(content),
        excerpt: excerpt || null,
        featuredImage: featuredImage || null,
        status: status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
        authorId: req.user!.userId,
      },
    });

    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/blog/:id — update a post
router.patch('/:id', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, slug, content, excerpt, featuredImage, status } = req.body;

    const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing) return next(createError('Post not found', 404));

    const wasPublished = existing.status === 'PUBLISHED';
    const nowPublished = status === 'PUBLISHED';

    const post = await prisma.blogPost.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(slug && { slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') }),
        ...(content !== undefined && { content: sanitizeBlogHtml(content) }),
        ...(excerpt !== undefined && { excerpt: excerpt || null }),
        ...(featuredImage !== undefined && { featuredImage: featuredImage || null }),
        ...(status && { status: nowPublished ? 'PUBLISHED' : 'DRAFT' }),
        ...(!wasPublished && nowPublished ? { publishedAt: new Date() } : {}),
      },
    });

    res.json({ post });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/blog/:id — delete a post
router.delete('/:id', authenticate, authorize('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing) return next(createError('Post not found', 404));

    await prisma.blogPost.delete({ where: { id: req.params.id } });
    res.json({ message: 'Post deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
