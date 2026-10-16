import { describe, it, expect } from 'vitest';
import { rejectObjectQuery } from './rejectObjectQuery';

function run(query: Record<string, unknown>) {
  let status = 0;
  let nextCalled = false;
  const res = { status(c: number) { status = c; return this; }, json() { return this; } };
  rejectObjectQuery({ query } as never, res as never, () => { nextCalled = true; });
  return { status, nextCalled };
}

describe('rejectObjectQuery', () => {
  it('passes strings and arrays of strings', () => {
    expect(run({ q: 'phone', page: '2', tag: ['a', 'b'] }).nextCalled).toBe(true);
  });
  it('blocks Prisma-style operator objects', () => {
    const r = run({ status: { not: 'ACTIVE' } });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(400);
  });
  it('blocks objects hidden inside arrays', () => {
    expect(run({ x: [{ contains: 'a' }] }).nextCalled).toBe(false);
  });
});
