import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { Readable, Writable } from 'stream';
import tar from 'tar-stream';
import type { S3MediaStore } from '../cdn';
import { createMediaService, isSafeRelativePath } from './mediaService';
import { BackupBusyError, BackupFileError } from './backupService';

/** In-memory stand-in for the bucket. */
class FakeS3 implements S3MediaStore {
  objects = new Map<string, Buffer>();
  puts: string[] = [];
  async *list() { for (const [key, b] of [...this.objects].sort()) yield { key, size: b.length }; }
  async get(key: string) { const b = this.objects.get(key); return b ? { stream: Readable.from([b]), size: b.length } : null; }
  async exists(key: string) { return this.objects.has(key); }
  async put(key: string, body: Readable, size: number) {
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(c as Buffer);
    const b = Buffer.concat(chunks);
    if (b.length !== size) throw new Error(`size mismatch for ${key}`);
    this.objects.set(key, b); this.puts.push(key);
  }
}

const rnd = (n: number) => crypto.randomBytes(n);
const collect = () => { const chunks: Buffer[] = []; const w = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } }); return { w, bytes: () => Buffer.concat(chunks) }; };

describe('isSafeRelativePath', () => {
  it('accepts normal keys, rejects anything that could escape or hide', () => {
    for (const ok of ['a.jpg', 'UGANDA/electronics/abc-1.webp', 'ñ/🚗.png']) expect(isSafeRelativePath(ok)).toBe(true);
    for (const bad of ['', '/abs', '../x', 'a/../b', 'a//b', './a', 'a\\b', 'a\0b', 'a/', 'x'.repeat(1025)]) expect(isSafeRelativePath(bad)).toBe(false);
  });
});

describe('media backup & restore', () => {
  let src: string, dst: string, tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-'));
    src = path.join(tmp, 'src-uploads'); dst = path.join(tmp, 'dst-uploads');
    fs.mkdirSync(src); fs.mkdirSync(dst);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const write = (root: string, rel: string, data: Buffer) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

  async function seedSource() {
    const s3 = new FakeS3();
    const files: Record<string, Buffer> = {
      'UGANDA/electronics/a.jpg': rnd(1500),
      ['UGANDA/' + 'très-long-ñame/'.repeat(10) + 'b.png']: rnd(700),
      'emoji-🚗.webp': rnd(10),
      'videos/big.mp4': rnd(3 * 1024 * 1024 + 17), // above the "small file" threshold: streamed
      'empty.bin': Buffer.alloc(0),
    };
    for (const [k, v] of Object.entries(files)) s3.objects.set(k, v);
    const local: Record<string, Buffer> = { 'documents/cv.pdf': rnd(4000), 'avatars/u1.png': rnd(321), 'kyc/id-front.jpg': rnd(999) };
    for (const [k, v] of Object.entries(local)) write(src, k, v);
    write(src, 'temp/in-flight.tmp', rnd(50)); // scratch space must never be backed up
    return { s3, files, local };
  }

  async function backupOf(svc: ReturnType<typeof createMediaService>, gzip = false) {
    const { w, bytes } = collect();
    const result = await svc.exportMedia(w, { createdBy: 'admin@test' });
    return { result, tarBytes: gzip ? zlib.gzipSync(bytes()) : bytes() };
  }
  async function entriesOf(buf: Buffer) {
    const out: { name: string; data: Buffer }[] = [];
    const ex = tar.extract(); Readable.from([buf]).pipe(ex);
    for await (const e of ex) { const chunks: Buffer[] = []; for await (const c of e) chunks.push(c as Buffer); out.push({ name: e.header.name, data: Buffer.concat(chunks) }); }
    return out;
  }
  async function runJob(svc: ReturnType<typeof createMediaService>, file: string, opts: { mode: 'skip-existing' | 'overwrite'; dryRun: boolean }) {
    const started = await svc.startRestore(file, opts);
    for (let i = 0; i < 400; i++) { const j = svc.getJob(started.id)!; if (j.state !== 'running') return j; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error('job did not finish');
  }
  const stage = (buf: Buffer, name = 'm.tar') => { const f = path.join(tmp, name); fs.writeFileSync(f, buf); return f; };

  it('exports a standard tar: manifest first, bucket + local files, end marker last, temp/ excluded', async () => {
    const { s3 } = await seedSource();
    const { result, tarBytes } = await backupOf(createMediaService({ s3, uploadsRoot: src }));
    expect(result).toMatchObject({ files: 8, missing: 0 });
    const names = (await entriesOf(tarBytes)).map((e) => e.name);
    expect(names[0]).toBe('manifest.json');
    expect(names[names.length - 1]).toBe('end.json');
    expect(names).toContain('s3/UGANDA/electronics/a.jpg');
    expect(names).toContain('local/kyc/id-front.jpg');
    expect(names.some((n) => n.includes('temp/'))).toBe(false);
  });

  it('restores every file byte-for-byte into a fresh bucket and uploads folder (also from .tar.gz)', async () => {
    for (const gzip of [false, true]) {
      const { s3, files, local } = await seedSource();
      const { tarBytes } = await backupOf(createMediaService({ s3, uploadsRoot: src }), gzip);
      const s3b = new FakeS3();
      fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst);
      const job = await runJob(createMediaService({ s3: s3b, uploadsRoot: dst }), stage(tarBytes, gzip ? 'm.tar.gz' : 'm.tar'), { mode: 'skip-existing', dryRun: false });
      expect(job).toMatchObject({ state: 'done', written: 8, skipped: 0, unavailable: 0, error: null });
      for (const [k, v] of Object.entries(files)) expect(s3b.objects.get(k)?.equals(v), k).toBe(true);
      for (const [k, v] of Object.entries(local)) expect(fs.readFileSync(path.join(dst, ...k.split('/'))).equals(v), k).toBe(true);
      expect(fs.existsSync(path.join(dst, 'temp'))).toBe(false);
      fs.rmSync(src, { recursive: true, force: true }); fs.mkdirSync(src);
    }
  });

  it('skip-existing never touches files that exist; overwrite replaces them; neither deletes anything', async () => {
    const { s3 } = await seedSource();
    const { tarBytes } = await backupOf(createMediaService({ s3, uploadsRoot: src }));
    const s3b = new FakeS3();
    s3b.objects.set('UGANDA/electronics/a.jpg', Buffer.from('NEWER'));
    s3b.objects.set('only-in-target.jpg', Buffer.from('keep me'));
    write(dst, 'documents/cv.pdf', Buffer.from('NEWER-LOCAL'));

    const svc = createMediaService({ s3: s3b, uploadsRoot: dst });
    const a = await runJob(svc, stage(tarBytes), { mode: 'skip-existing', dryRun: false });
    expect(a).toMatchObject({ state: 'done', skipped: 2, written: 6 });
    expect(s3b.objects.get('UGANDA/electronics/a.jpg')!.toString()).toBe('NEWER');
    expect(fs.readFileSync(path.join(dst, 'documents', 'cv.pdf')).toString()).toBe('NEWER-LOCAL');

    const b = await runJob(svc, stage(tarBytes), { mode: 'overwrite', dryRun: false });
    expect(b).toMatchObject({ state: 'done', skipped: 0, written: 8 });
    expect(s3b.objects.get('UGANDA/electronics/a.jpg')!.length).toBe(1500);
    expect(s3b.objects.get('only-in-target.jpg')!.toString()).toBe('keep me'); // never deleted
  });

  it('a check (dry run) reports what would happen and writes nothing', async () => {
    const { s3 } = await seedSource();
    const { tarBytes } = await backupOf(createMediaService({ s3, uploadsRoot: src }));
    const s3b = new FakeS3(); s3b.objects.set('empty.bin', Buffer.alloc(0));
    const job = await runJob(createMediaService({ s3: s3b, uploadsRoot: dst }), stage(tarBytes), { mode: 'skip-existing', dryRun: true });
    expect(job).toMatchObject({ state: 'done', dryRun: true, total: 8, written: 7, skipped: 1 });
    expect(s3b.puts).toEqual([]);
    expect(fs.readdirSync(dst)).toEqual([]);
  });

  it('refuses a file that is not a media backup, immediately, and frees the lock', async () => {
    const svc = createMediaService({ s3: new FakeS3(), uploadsRoot: dst });
    await expect(svc.startRestore(stage(Buffer.from('hello world, not a tar'), 'junk.tar'), { mode: 'skip-existing', dryRun: true })).rejects.toBeInstanceOf(BackupFileError);
    const pack = tar.pack(); const chunks: Buffer[] = []; pack.on('data', (c) => chunks.push(c));
    pack.entry({ name: 'something-else.txt' }, 'x'); pack.finalize(); await new Promise((r) => pack.on('end', r));
    await expect(svc.startRestore(stage(Buffer.concat(chunks), 'other.tar'), { mode: 'skip-existing', dryRun: true })).rejects.toThrow(/not a Piitrade media backup/);
    // lock was released: a valid job can start afterwards
    const { s3 } = await seedSource();
    const { tarBytes } = await backupOf(createMediaService({ s3, uploadsRoot: src }));
    expect((await runJob(svc, stage(tarBytes), { mode: 'skip-existing', dryRun: true })).state).toBe('done');
  });

  it('a truncated archive fails with a clear message, keeps what was written, and can be finished by re-running', async () => {
    const { s3, files } = await seedSource();
    const { tarBytes } = await backupOf(createMediaService({ s3, uploadsRoot: src }));
    const cut = tarBytes.subarray(0, Math.floor(tarBytes.length * 0.8));
    const s3b = new FakeS3();
    const svc = createMediaService({ s3: s3b, uploadsRoot: dst });
    const failed = await runJob(svc, stage(cut), { mode: 'skip-existing', dryRun: false });
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/incomplete|corrupt|truncated|valid/i);
    const done = await runJob(svc, stage(tarBytes), { mode: 'skip-existing', dryRun: false });
    expect(done.state).toBe('done');
    for (const [k, v] of Object.entries(files)) expect(s3b.objects.get(k)?.equals(v), k).toBe(true);
  });

  it('ignores hostile paths in an archive: nothing is written outside the uploads folder', async () => {
    const pack = tar.pack(); const chunks: Buffer[] = []; pack.on('data', (c) => chunks.push(c));
    const add = (name: string, body: string) => new Promise<void>((res, rej) => pack.entry({ name, size: Buffer.byteLength(body) }, body, (e) => (e ? rej(e) : res())));
    await add('manifest.json', JSON.stringify({ type: 'manifest', format: 'piitrade-media-backup', version: 1, createdAt: new Date().toISOString(), createdBy: null, files: [] }));
    await add('local/../../evil.txt', 'pwned');
    await add('local/temp/x.txt', 'reserved');
    await add('local//abs.txt', 'abs');
    await add('s3/../../k', 'bad key');
    await add('local/fine/ok.txt', 'ok');
    await add('end.json', '{"type":"end"}');
    pack.finalize(); await new Promise((r) => pack.on('end', r));
    const s3b = new FakeS3();
    const job = await runJob(createMediaService({ s3: s3b, uploadsRoot: dst }), stage(Buffer.concat(chunks)), { mode: 'overwrite', dryRun: false });
    expect(job).toMatchObject({ state: 'done', written: 1, unavailable: 4 });
    expect(job.warnings.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmp, 'evil.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dst, 'temp'))).toBe(false);
    expect(fs.readFileSync(path.join(dst, 'fine', 'ok.txt')).toString()).toBe('ok');
    expect(s3b.puts).toEqual([]);
  });

  it('skips bucket files with a warning when S3 is not configured on the target, but still restores local ones', async () => {
    const { s3 } = await seedSource();
    const { tarBytes } = await backupOf(createMediaService({ s3, uploadsRoot: src }));
    const job = await runJob(createMediaService({ s3: null, uploadsRoot: dst }), stage(tarBytes), { mode: 'skip-existing', dryRun: false });
    expect(job).toMatchObject({ state: 'done', written: 3, unavailable: 5 });
    expect(job.warnings.join(' ')).toMatch(/S3 is not configured/);
  });

  it('runs one job at a time', async () => {
    const { s3 } = await seedSource();
    const svc = createMediaService({ s3, uploadsRoot: src });
    const { tarBytes } = await backupOf(svc);
    const first = svc.startRestore(stage(tarBytes, 'a.tar'), { mode: 'skip-existing', dryRun: true });
    await expect(svc.startRestore(stage(tarBytes, 'b.tar'), { mode: 'skip-existing', dryRun: true })).rejects.toBeInstanceOf(BackupBusyError);
    const j = await first;
    for (let i = 0; i < 200 && svc.getJob(j.id)!.state === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(svc.getJob(j.id)!.state).toBe('done');
  });

  it('info reports bucket and local totals (temp/ excluded)', async () => {
    const { s3 } = await seedSource();
    const info = await createMediaService({ s3, uploadsRoot: src }).info();
    expect(info.s3).toMatchObject({ configured: true, objects: 5 });
    expect(info.local.files).toBe(3);
  });
});
