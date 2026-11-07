import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import tar from 'tar-stream';
import { TEST_DB, configureTestEnv, loadDeps, resetDb, mkUser, mkCategory, mkListing } from './testing/integrationDb';

configureTestEnv();

describe.skipIf(!TEST_DB)('admin backup & restore over HTTP (real database)', () => {
  let prisma: Awaited<ReturnType<typeof loadDeps>>['prisma'];
  let token: Awaited<ReturnType<typeof loadDeps>>['generateAccessToken'];
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const d = await loadDeps();
    prisma = d.prisma; token = d.generateAccessToken;
    const { default: app } = await import('./app');
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); await prisma.$disconnect(); });
  beforeEach(async () => { await resetDb(prisma); });

  const auth = (u: { id: string; email: string }, role: string) => ({ Authorization: `Bearer ${token({ userId: u.id, email: u.email, role })}` });

  async function fixture() {
    const admin = await mkUser(prisma, { role: 'ADMIN', isPrimaryAdmin: true } /* backup & restore are primary-admin only */);
    const seller = await mkUser(prisma);
    const cat = await mkCategory(prisma, 'motors');
    await mkListing(prisma, seller.id, cat.id);
    await mkListing(prisma, seller.id, cat.id);
    return { admin, seller, headers: auth(admin, 'ADMIN') };
  }

  const restore = (headers: Record<string, string>, bytes: Buffer | null, fields: Record<string, string>, name = 'backup.ndjson.gz', route = '/restore') => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (bytes) form.append('file', new Blob([new Uint8Array(bytes)]), name);
    return fetch(`${base}/api/admin/backup${route}`, { method: 'POST', headers, body: form });
  };

  it('is admin-only', async () => {
    const { seller } = await fixture();
    expect((await fetch(`${base}/api/admin/backup/info`)).status).toBe(401);
    expect((await fetch(`${base}/api/admin/backup/info`, { headers: auth(seller, 'BUYER') })).status).toBe(403);
    expect((await fetch(`${base}/api/admin/backup/download`, { headers: auth(seller, 'BUYER') })).status).toBe(403);
    expect((await restore(auth(seller, 'BUYER'), Buffer.from('x'), { mode: 'merge' })).status).toBe(403);
  });

  it('GET /info lists every table with row counts', async () => {
    const { headers } = await fixture();
    const body = await (await fetch(`${base}/api/admin/backup/info`, { headers })).json();
    expect(body.tables.find((t: { name: string }) => t.name === 'Listing').rows).toBe(2);
    expect(body.totalRows).toBeGreaterThan(4);
    expect(body.maxUploadMb).toBeGreaterThan(0);
  });

  it('GET /download streams a valid gzip backup with download headers, and audits it', async () => {
    const { headers, admin } = await fixture();
    const res = await fetch(`${base}/api/admin/backup/download`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="piitrade-backup-.*\.ndjson\.gz"/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const lines = zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8').trim().split('\n');
    expect(JSON.parse(lines[0])).toMatchObject({ format: 'piitrade-backup', createdBy: admin.email });
    expect(JSON.parse(lines[lines.length - 1]).type).toBe('end');
    await new Promise((r) => setTimeout(r, 300)); // audit is written after the stream ends
    expect(await prisma.adminAuditLog.count({ where: { action: 'BACKUP_DOWNLOADED', actorId: admin.id } })).toBe(1);

    const plain = await fetch(`${base}/api/admin/backup/download?compress=0`, { headers });
    expect(plain.headers.get('content-disposition')).toMatch(/\.ndjson"/);
    expect(JSON.parse((await plain.text()).split('\n')[0]).type).toBe('header');
  });

  it('download → wipe → upload with REPLACE brings everything back', async () => {
    const { headers, admin } = await fixture();
    const file = Buffer.from(await (await fetch(`${base}/api/admin/backup/download`, { headers })).arrayBuffer());
    await prisma.listing.deleteMany();
    expect(await prisma.listing.count()).toBe(0);

    // dry run first: reports, changes nothing
    const dry = await restore(headers, file, { mode: 'replace', dryRun: 'true' });
    expect(dry.status).toBe(200);
    expect((await dry.json()).tables.find((t: { name: string }) => t.name === 'Listing')).toMatchObject({ rowsInFile: 2, rowsNow: 0 });
    expect(await prisma.listing.count()).toBe(0);

    // replace without the typed confirmation is refused
    const noConfirm = await restore(headers, file, { mode: 'replace' });
    expect(noConfirm.status).toBe(400);
    expect((await noConfirm.json()).message).toMatch(/RESTORE/);
    expect(await prisma.listing.count()).toBe(0);

    const ok = await restore(headers, file, { mode: 'replace', confirm: 'RESTORE' });
    expect(ok.status).toBe(200);
    expect(await prisma.listing.count()).toBe(2);
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.adminAuditLog.count({ where: { action: 'BACKUP_RESTORED', actorId: admin.id } })).toBe(1);
  });

  it('rejects bad input with clear 4xx errors', async () => {
    const { headers } = await fixture();
    expect((await restore(headers, null, { mode: 'merge' })).status).toBe(400);                       // no file
    expect((await restore(headers, Buffer.from('{}'), { mode: 'merge' }, 'evil.html')).status).toBe(400); // wrong type
    expect((await restore(headers, Buffer.from('{"a":1}\n'), { mode: 'bogus' })).status).toBe(400);       // bad mode
    const notBackup = await restore(headers, Buffer.from('{"a":1}\n'), { mode: 'merge' }, 'x.ndjson');
    expect(notBackup.status).toBe(400);
    expect((await notBackup.json()).message).toMatch(/not a Piitrade backup/);
  });

  describe('media files', () => {
    const folder = `zz-media-test-${Date.now().toString(36)}`;
    const dir = path.join(process.cwd(), 'uploads', folder);
    const file = path.join(dir, 'photo.jpg');
    const bytes = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7) % 256));
    beforeEach(() => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, bytes); });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    const entries = async (buf: Buffer) => {
      const out: Record<string, Buffer> = {};
      const ex = tar.extract(); Readable.from([buf]).pipe(ex);
      for await (const e of ex) { const c: Buffer[] = []; for await (const d of e) c.push(d as Buffer); out[e.header.name] = Buffer.concat(c); }
      return out;
    };
    const pollJob = async (headers: Record<string, string>) => {
      for (let i = 0; i < 200; i++) {
        const { job } = await (await fetch(`${base}/api/admin/backup/media/jobs/current`, { headers })).json();
        if (job && job.state !== 'running') return job;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('media job did not finish');
    };

    it('is admin-only', async () => {
      const { seller } = await fixture();
      const h = auth(seller, 'BUYER');
      for (const url of ['/media/info', '/media/download', '/media/jobs/current']) {
        expect((await fetch(`${base}/api/admin/backup${url}`, { headers: h })).status).toBe(403);
      }
      expect((await restore(h, Buffer.from('x'), { mode: 'skip-existing' }, 'm.tar', '/media/restore')).status).toBe(403);
    });

    it('download → delete the file → check → restore brings it back byte-for-byte', async () => {
      const { headers, admin } = await fixture();
      const info = await (await fetch(`${base}/api/admin/backup/media/info`, { headers })).json();
      expect(info.local.files).toBeGreaterThanOrEqual(1);

      const res = await fetch(`${base}/api/admin/backup/media/download`, { headers });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toMatch(/piitrade-media-.*\.tar"/);
      const tarBytes = Buffer.from(await res.arrayBuffer());
      const got = await entries(tarBytes);
      expect(got[`local/${folder}/photo.jpg`]?.equals(bytes)).toBe(true);
      expect(Object.keys(got)[0]).toBe('manifest.json');

      const gz = await fetch(`${base}/api/admin/backup/media/download?compress=1`, { headers });
      expect(gz.headers.get('content-disposition')).toMatch(/\.tar\.gz"/);
      expect((await entries(zlib.gunzipSync(Buffer.from(await gz.arrayBuffer()))))[`local/${folder}/photo.jpg`]).toBeTruthy();

      fs.rmSync(file);
      const mname = 'media.tar';
      const check = await restore(headers, tarBytes, { mode: 'skip-existing', dryRun: 'true' }, mname, '/media/restore');
      expect(check.status).toBe(202);
      const checked = await pollJob(headers);
      expect(checked).toMatchObject({ state: 'done', dryRun: true });
      expect(fs.existsSync(file)).toBe(false); // a check changes nothing

      expect((await restore(headers, tarBytes, { mode: 'overwrite' }, mname, '/media/restore')).status).toBe(400); // needs typed confirmation
      const real = await restore(headers, tarBytes, { mode: 'skip-existing' }, mname, '/media/restore');
      expect(real.status).toBe(202);
      expect(await pollJob(headers)).toMatchObject({ state: 'done', dryRun: false, error: null });
      expect(fs.readFileSync(file).equals(bytes)).toBe(true);

      await new Promise((r) => setTimeout(r, 300));
      expect(await prisma.adminAuditLog.count({ where: { action: 'MEDIA_RESTORE_STARTED', actorId: admin.id } })).toBe(1);
      expect(await prisma.adminAuditLog.count({ where: { action: 'MEDIA_BACKUP_DOWNLOADED', actorId: admin.id } })).toBe(2);
    });

    it('rejects wrong files with 400 and polling is not rate-limited', async () => {
      const { headers } = await fixture();
      expect((await restore(headers, Buffer.from('not a tar at all'), { mode: 'skip-existing' }, 'x.tar', '/media/restore')).status).toBe(400);
      expect((await restore(headers, Buffer.from('x'), { mode: 'skip-existing' }, 'x.exe', '/media/restore')).status).toBe(400);
      expect((await restore(headers, null, { mode: 'skip-existing' }, 'x.tar', '/media/restore')).status).toBe(400);
      for (let i = 0; i < 40; i++) expect((await fetch(`${base}/api/admin/backup/media/jobs/current`, { headers })).status).toBe(200);
    });

    it('a rejected media upload (another job running) does not leave the staged file behind', async () => {
      const { headers } = await fixture();
      const staging = path.join(os.tmpdir(), 'piitrade-backup-staging');
      const count = () => fs.readdirSync(staging).filter((f) => f.startsWith('media-restore-')).length;
      const before = count();
      const { acquireJob, releaseJob } = await import('./utils/backup/backupService');
      acquireJob('test job');
      try {
        expect((await restore(headers, Buffer.from('whatever'), { mode: 'skip-existing' }, 'x.tar', '/media/restore')).status).toBe(409);
      } finally {
        releaseJob();
      }
      await new Promise((r) => setTimeout(r, 200));
      expect(count()).toBe(before);
    });
  });
});
