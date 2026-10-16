import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

// These exercise middleware ordering on the REAL app. They avoid any route that needs a database.
process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/none?schema=public';
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.CORS_ORIGIN = 'https://app.example.com,*';
process.env.NODE_ENV = 'test';

let server: Server;
let base = '';

beforeAll(async () => {
  const { default: app } = await import('./app');
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

describe('app-level hardening', () => {
  it('health/services reports only ok/error, never configuration details', async () => {
    const res = await fetch(`${base}/health/services`);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['status']);
  });

  it('never reflects an arbitrary origin even if CORS_ORIGIN contains "*"', async () => {
    const evil = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const good = await fetch(`${base}/health`, { headers: { Origin: 'https://app.example.com' } });
    expect(good.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('KYC and document files are not served by the public image proxy or static mount', async () => {
    for (const p of ['/api/images/kyc%2Fabc.jpg', '/api/images/documents%2Fabc.pdf', '/uploads/kyc/abc.jpg', '/uploads/documents/abc.pdf', '/uploads/%6Bkyc/abc.jpg']) {
      const res = await fetch(`${base}${p}`);
      expect([403, 404]).toContain(res.status);
    }
    expect((await fetch(`${base}/api/images/kyc%2Fabc.jpg`)).status).toBe(403);
    expect((await fetch(`${base}/uploads/kyc/abc.jpg`)).status).toBe(403);
  });

  it('rejects Prisma-operator style nested query parameters', async () => {
    const res = await fetch(`${base}/api/listings?status[not]=ACTIVE`);
    expect(res.status).toBe(400);
  });

  it('sets nosniff and does not advertise Express', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('refresh/logout refuse browser requests from an untrusted Origin (cookie CSRF)', async () => {
    for (const p of ['/api/auth/refresh', '/api/auth/logout']) {
      const res = await fetch(`${base}${p}`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
      expect(res.status).toBe(403);
    }
  });

  it('admin-register is hidden in production unless explicitly enabled', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_ADMIN_REGISTER;
    const res = await fetch(`${base}/api/auth/admin-register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    process.env.NODE_ENV = prev;
    expect(res.status).toBe(404);
  });

  it('protected endpoints demand a token', async () => {
    for (const [m, p] of [['GET', '/api/messages/conversations'], ['POST', '/api/upload/kyc-document'], ['GET', '/api/upload/kyc-file?url=x'], ['GET', '/api/admin/users']] as const) {
      const res = await fetch(`${base}${p}`, { method: m });
      expect([401, 403]).toContain(res.status);
    }
  });
});
