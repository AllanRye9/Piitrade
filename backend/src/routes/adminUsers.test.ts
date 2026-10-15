/** DELETE /api/admin/users/:id — self-protection and a useful message when the user owns records. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const state = { deleteImpl: async (_a: unknown): Promise<unknown> => ({}) };
vi.mock('../utils/prisma', () => ({ prisma: { user: { delete: (a: unknown) => state.deleteImpl(a) } } }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _s: unknown, n: () => void) => { req.user = { userId: 'admin1' }; n(); },
  authorize: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
import { errorHandler } from '../middleware/errorHandler';

let server: Server; let base = '';
beforeAll(async () => {
  const { default: adminRouter } = await import('./admin');
  const app = express(); app.use(express.json()); app.use('/api/admin', adminRouter); app.use(errorHandler);
  await new Promise<void>((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/users`;
});
afterAll(() => { server.close(); });
beforeEach(() => { state.deleteImpl = async () => ({}); });
const del = (id: string) => fetch(`${base}/${id}`, { method: 'DELETE' });
const prismaErr = (code: string) => Object.assign(new Error(code), { code });

describe('DELETE /api/admin/users/:id', () => {
  it('deletes a user', async () => {
    const r = await del('u2');
    expect(r.status).toBe(200);
  });
  it('refuses to delete your own account', async () => {
    const r = await del('admin1');
    expect(r.status).toBe(400);
  });
  it('a user who still owns orders/records → 409 with an actionable message (not "Related record not found")', async () => {
    state.deleteImpl = async () => { throw prismaErr('P2003'); };
    const r = await del('u2');
    expect(r.status).toBe(409);
    const body = (await r.json()) as { message: string };
    expect(body.message).toMatch(/linked records.*Ban the account instead/);
  });
  it('an unknown user stays a 404', async () => {
    state.deleteImpl = async () => { throw prismaErr('P2025'); };
    expect((await del('ghost')).status).toBe(404);
  });
});
