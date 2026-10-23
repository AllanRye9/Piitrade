import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();

const VALID_SERVICE_TYPES = [
  'linkedin',
  'cv-writing',
  'career',
  'coaching',
  'interview',
  'cover-letter',
  'template',
];

// POST /api/cv-service-requests — submit a CV service request (public)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const serviceType = String(req.body?.serviceType ?? 'cv-service');
    if (!VALID_SERVICE_TYPES.includes(serviceType)) {
      return next(createError('Invalid serviceType', 400));
    }

    res.status(410).json({
      message: 'Manual CV service requests have been retired. Use the in-app digital CV tools; CV downloads are paid per download.',
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cv-service-requests — admin only: list all requests
router.get('/', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20')));
    const skip = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const serviceType = req.query.serviceType as string | undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (serviceType) where.serviceType = serviceType;

    const [requests, total] = await Promise.all([
      prisma.cvServiceRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.cvServiceRequest.count({ where }),
    ]);

    res.json({ requests, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cv-service-requests/:id — admin only: update status
router.patch('/:id', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'in-progress', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return next(createError('Invalid status', 400));
    }

    const updated = await prisma.cvServiceRequest.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
