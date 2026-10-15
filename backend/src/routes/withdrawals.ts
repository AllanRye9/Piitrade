import { Router, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();

router.use(authenticate);

// GET /api/withdrawals — list seller's withdrawals
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ withdrawals });
  } catch (err) {
    next(err);
  }
});

// POST /api/withdrawals — request a withdrawal
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { amount, currency, method, accountInfo } = req.body;

    if (!amount || !accountInfo) return next(createError('amount and accountInfo are required', 400));

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return next(createError('amount must be a positive number', 400));
    }

    // Check available balance
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { balance: true },
    });
    if (!user) return next(createError('User not found', 404));
    if (user.balance < parsedAmount) {
      return next(createError('Insufficient balance', 400));
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      const w = await tx.withdrawal.create({
        data: {
          userId: req.user!.userId,
          amount: parsedAmount,
          currency: currency || 'UGX',
          method: method || 'BANK_TRANSFER',
          accountInfo,
        },
      });
      // Deduct from balance immediately to prevent double-withdrawals
      await tx.user.update({
        where: { id: req.user!.userId },
        data: { balance: { decrement: parsedAmount } },
      });
      return w;
    });

    res.status(201).json({ withdrawal });
  } catch (err) {
    next(err);
  }
});

export default router;
