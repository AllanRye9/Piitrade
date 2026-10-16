import { Request, Response, NextFunction } from 'express';

/**
 * Express parses `?status[not]=ACTIVE` into `{ status: { not: 'ACTIVE' } }`.
 * Handlers routinely do `req.query.status as string` (a compile-time cast only)
 * and pass the value to Prisma, where an object is interpreted as a FILTER
 * ("operator injection"). No endpoint in this app needs nested query objects,
 * so reject them globally. Plain strings and arrays of strings are unaffected.
 */
const isNestedObject = (v: unknown): boolean => {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some(isNestedObject);
  return true;
};

export function rejectObjectQuery(req: Request, res: Response, next: NextFunction): void {
  for (const value of Object.values(req.query)) {
    if (isNestedObject(value)) {
      res.status(400).json({ message: 'Invalid query parameters' });
      return;
    }
  }
  next();
}
