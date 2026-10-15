/**
 * Money-integrity tests for PUT /api/admin/withdrawals/:id, running the real
 * admin router against an in-memory Prisma fake that has atomic conditional
 * updates and transaction rollback. Balance is deducted when a withdrawal is
 * requested, so REJECTED must refund exactly once and never after a payout.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

type W = { id: string; userId: string; amount: number; currency: string; status: string; note: string | null; processedAt: Date | null };
const db = { w: new Map<string, W>(), balance: new Map<string, number>(), notes: [] as unknown[], failRefund: false };

function fake(undo: Array<() => void>) {
  const setW = (id: string, next: W) => { const prev = db.w.get(id); db.w.set(id, next); undo.push(() => { if (prev) db.w.set(id, prev); }); };
  return {
    withdrawal: {
      findUnique: async ({ where }: { where: { id: string } }) => { await Promise.resolve(); const r = db.w.get(where.id); return r ? { ...r } : null; },
      // Plain unconditional update (what a non-guarded handler would use).
      update: async ({ where, data }: { where: { id: string }; data: Partial<W> }) => {
        const r = db.w.get(where.id); if (!r) throw new Error('nf');
        const n = { ...r, ...data }; setW(r.id, n); return { ...n };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => { const r = db.w.get(where.id); if (!r) throw new Error('nf'); return { ...r }; },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<W> }) => {
        await Promise.resolve();
        const r = db.w.get(where.id);
        if (!r || r.status !== where.status) return { count: 0 };
        setW(r.id, { ...r, ...data });
        return { count: 1 };
      },
    },
    user: {
      update: async ({ where, data }: { where: { id: string }; data: { balance: { increment: number } } }) => {
        if (db.failRefund) throw new Error('db down');
        db.balance.set(where.id, (db.balance.get(where.id) ?? 0) + data.balance.increment);
        undo.push(() => db.balance.set(where.id, (db.balance.get(where.id) ?? 0) - data.balance.increment));
        return {};
      },
    },
    notification: { create: async (a: unknown) => { db.notes.push(a); return a; } },
  };
}
// Each transaction rolls back only ITS OWN writes (like a real database).
vi.mock('../utils/prisma', () => {
  const noTx = fake([]);
  return {
    prisma: {
      ...noTx,
      $transaction: async (cb: (tx: ReturnType<typeof fake>) => Promise<unknown>) => {
        const undo: Array<() => void> = [];
        try { return await cb(fake(undo)); } catch (e) { undo.reverse().forEach((u) => u()); throw e; }
      },
    },
  };
});
vi.mock('../middleware/auth', () => ({
  authenticate: (_q: unknown, _s: unknown, n: () => void) => n(),
  authorize: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import { errorHandler } from '../middleware/errorHandler';
let server: Server; let base = '';
beforeAll(async () => {
  const { default: adminRouter } = await import('./admin');
  const app = express(); app.use(express.json()); app.use('/api/admin', adminRouter); app.use(errorHandler);
  await new Promise<void>((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/withdrawals`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  db.w = new Map([['w1', { id: 'w1', userId: 'u1', amount: 50000, currency: 'UGX', status: 'PENDING', note: null, processedAt: null }]]);
  db.balance = new Map([['u1', 100000]]); // after the 50k deduction at request time
  db.notes = []; db.failRefund = false;
});
const put = (id: string, body: unknown) => fetch(`${base}/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('admin withdrawals', () => {
  it('rejecting a PENDING withdrawal refunds exactly once and notifies', async () => {
    const r = await put('w1', { status: 'REJECTED', note: 'bad account' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).withdrawal).toMatchObject({ status: 'REJECTED', note: 'bad account' });
    expect(db.balance.get('u1')).toBe(150000);
    expect(db.notes.length).toBe(1);
  });
  it('a second reject (retry / second admin / stale tab) is refused and does NOT refund again', async () => {
    await put('w1', { status: 'REJECTED' });
    const again = await put('w1', { status: 'REJECTED' });
    expect(again.status).toBe(409);
    expect(db.balance.get('u1')).toBe(150000);
  });
  it('rejecting after the payout was completed is refused and does NOT refund', async () => {
    expect((await put('w1', { status: 'COMPLETED' })).status).toBe(200);
    const r = await put('w1', { status: 'REJECTED' });
    expect(r.status).toBe(409);
    expect(db.balance.get('u1')).toBe(100000);
    expect(db.w.get('w1')!.status).toBe('COMPLETED');
  });
  it('a rejected withdrawal cannot be re-opened as COMPLETED', async () => {
    await put('w1', { status: 'REJECTED' });
    expect((await put('w1', { status: 'COMPLETED' })).status).toBe(409);
    expect(db.w.get('w1')!.status).toBe('REJECTED');
  });
  it('two simultaneous rejects: exactly one wins, balance refunded once', async () => {
    const [a, b] = await Promise.all([put('w1', { status: 'REJECTED' }), put('w1', { status: 'REJECTED' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(db.balance.get('u1')).toBe(150000);
  });
  it('approving (COMPLETED) pays out without touching the balance and stamps processedAt', async () => {
    const r = await put('w1', { status: 'COMPLETED' });
    expect(r.status).toBe(200);
    expect(db.balance.get('u1')).toBe(100000);
    expect(db.w.get('w1')!.processedAt).toBeInstanceOf(Date);
  });
  it('APPROVED can still move on to COMPLETED or REJECTED (refund once)', async () => {
    expect((await put('w1', { status: 'APPROVED' })).status).toBe(200);
    expect((await put('w1', { status: 'REJECTED' })).status).toBe(200);
    expect(db.balance.get('u1')).toBe(150000);
  });
  it('if the refund fails the status change is rolled back (never "rejected without refund")', async () => {
    db.failRefund = true;
    const r = await put('w1', { status: 'REJECTED' });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(db.w.get('w1')!.status).toBe('PENDING');
    expect(db.balance.get('u1')).toBe(100000);
    expect(db.notes.length).toBe(0);
  });
  it('validates input: missing/unknown status → 400, unknown id → 404', async () => {
    expect((await put('w1', {})).status).toBe(400);
    expect((await put('w1', { status: 'PAID' })).status).toBe(400);
    expect((await put('w1', { status: 'toString' })).status).toBe(400);
    expect((await put('nope', { status: 'REJECTED' })).status).toBe(404);
  });
});
