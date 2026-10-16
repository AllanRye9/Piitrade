import crypto from 'crypto';

/** Constant-time string comparison (does not leak how many leading characters matched). */
export function safeEqual(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
