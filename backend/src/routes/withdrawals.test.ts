/**
 * POST /api/withdrawals must never let a seller withdraw more than their
 * balance, even with simultaneous requests (check-then-act race).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const db = { balance: 100000, withdrawals: [] as any[] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fake(undo: Array<() => void>) {
  return {
    user: {
      // Slow read so concurrent requests overlap between check and debit.
      findUnique: async () => { const b = db.balance; await sleep(15); return { balance: b }; },
      updateMany: async ({ where, data }: any) => {
        await sleep(1);
        if (db.balance < where.balance.gte) return { count: 0 };
        db.balance -= data.balance.decrement;
        undo.push(() => { db.balance += data.balance.decrement; });
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        await sleep(1);
        db.balance -= data.balance.decrement;
        undo.push(() => { db.balance += data.balance.decrement; });
        return {};
      },
    },
    withdrawal: {
      create: async ({ data }: any) => {
        const w = { id: 'w' + (db.withdrawals.length + 1), ...data };
        db.withdrawals.push(w);
        undo.push(() => { db.withdrawals = db.withdrawals.filter((x) => x !== w); });
        return w;
      },
    },
  };
}
// Each transaction rolls back only ITS OWN writes (like a real database).
vi.mock('../utils/prisma', () => {
  const noTx = fake([]);
  return { prisma: { ...noTx, $transaction: async (cb: any) => {
    const undo: Array<() => void> = [];
    try { return await cb(fake(undo)); } catch (e) { undo.reverse().forEach((u) => u()); throw e; }
  } } };
});
vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _s: unknown, n: () => void) => { req.user = { userId: 'u1' }; n(); },
}));
import { errorHandler } from '../middleware/errorHandler';

let server: Server; let url = '';
beforeAll(async () => {
  const { default: router } = await import('./withdrawals');
  const app = express(); app.use(express.json()); app.use('/api/withdrawals', router); app.use(errorHandler);
  await new Promise<void>((r) => { server = app.listen(0, r); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/withdrawals`;
});
afterAll(() => { server.close(); });
beforeEach(() => { db.balance = 100000; db.withdrawals = []; });
const post = (amount: number) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount, accountInfo: { account: '123' } }) });

describe('POST /api/withdrawals', () => {
  it('creates a withdrawal and deducts the balance', async () => {
    const r = await post(30000);
    expect(r.status).toBe(201);
    expect(db.balance).toBe(70000);
    expect(db.withdrawals.length).toBe(1);
  });
  it('rejects more than the balance with 400 and changes nothing', async () => {
    const r = await post(100001);
    expect(r.status).toBe(400);
    expect(db.balance).toBe(100000);
    expect(db.withdrawals.length).toBe(0);
  });
  it('two simultaneous requests that together exceed the balance: only one succeeds, balance never negative', async () => {
    const [a, b] = await Promise.all([post(80000), post(80000)]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(db.balance).toBe(20000);
    expect(db.withdrawals.length).toBe(1);
  });
  it('validation still applies', async () => {
    expect((await post(0)).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 5 }) })).status).toBe(400);
  });
});
