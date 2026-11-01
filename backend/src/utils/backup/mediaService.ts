/**
 * mediaService.ts — backup and restore of uploaded files (images, videos, documents, KYC scans).
 *
 * Files live in two places and both are covered:
 *   • the S3-compatible bucket (when ACCESS_KEY_ID / SECRET_ACCESS_KEY / BUCKET are set), and
 *   • the local `uploads/` folder (the fallback store; also where private documents live there).
 * Database rows point at files by key / path (`/api/images/<key>`, `/uploads/<path>`), so restoring a
 * file under the SAME key makes every existing URL work again.
 *
 * Archive format: a standard tar (optionally gzipped — photos are already compressed, so the default
 * is plain .tar), openable with any archive tool:
 *   manifest.json        what the archive was meant to contain
 *   s3/<object key>      one entry per bucket object
 *   local/<path>         one entry per file under uploads/
 *   end.json             written last; its presence proves the archive is complete
 *
 * Restore NEVER deletes anything. "skip-existing" only fills gaps; "overwrite" replaces files that have
 * the same key. Unlike the database restore it cannot be one transaction, so a restore that fails half
 * way keeps what it already wrote — simply run it again with "skip-existing" to carry on.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable, Transform, Writable, pipeline } from 'stream';
import { pipeline as pipelineAsync } from 'stream/promises';
import tar from 'tar-stream';
import { v4 as uuidv4 } from 'uuid';
import type { S3MediaStore } from '../cdn';
import { logger } from '../logger';
import { acquireJob, releaseJob, BackupFileError } from './backupService';

export const MEDIA_FORMAT = 'piitrade-media-backup';
export const MEDIA_VERSION = 1;
const MAX_MANIFEST_BYTES = 256 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024 * 1024; // zip-bomb guard for .tar.gz uploads
const SMALL_FILE_BYTES = 2 * 1024 * 1024; // small files are uploaded several at a time
const PARALLEL = 8;
/** Never backed up or restored: scratch space for in-flight uploads. */
const LOCAL_EXCLUDED_TOP_DIRS = new Set(['temp']);

export type MediaRestoreMode = 'skip-existing' | 'overwrite';

export interface MediaDeps {
  s3: S3MediaStore | null;
  uploadsRoot: string;
}

interface ManifestFile { src: 's3' | 'local'; key: string; size: number }
export interface MediaManifest {
  type: 'manifest';
  format: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  files: ManifestFile[];
}

export interface MediaJob {
  id: string;
  kind: 'media-restore';
  state: 'running' | 'done' | 'failed';
  dryRun: boolean;
  mode: MediaRestoreMode;
  backupCreatedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Files the archive claims to hold, and how many have been looked at so far. */
  total: number;
  processed: number;
  written: number;
  skipped: number;
  unavailable: number;
  bytes: number;
  warnings: string[];
  error: string | null;
}

/** A key/path from an archive must never be able to escape its storage root or hide odd bytes. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 1024 || p.startsWith('/') || p.includes('\0') || p.includes('\\')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export function createMediaService(deps: MediaDeps) {
  const { uploadsRoot } = deps;
  const resolveLocal = (rel: string): string | null => {
    if (!isSafeRelativePath(rel)) return null;
    if (LOCAL_EXCLUDED_TOP_DIRS.has(rel.split('/')[0])) return null;
    const full = path.join(uploadsRoot, ...rel.split('/'));
    return full.startsWith(path.resolve(uploadsRoot) + path.sep) ? full : null;
  };

  async function* walkLocal(dir = uploadsRoot, rel = ''): AsyncGenerator<{ key: string; size: number }> {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && LOCAL_EXCLUDED_TOP_DIRS.has(e.name)) continue;
      if (e.isDirectory()) yield* walkLocal(path.join(dir, e.name), childRel);
      else if (e.isFile()) { // symlinks and specials are deliberately ignored
        const st = await fs.promises.stat(path.join(dir, e.name));
        yield { key: childRel, size: st.size };
      }
    }
  }

  async function info() {
    let s3Objects = 0, s3Bytes = 0;
    if (deps.s3) for await (const o of deps.s3.list()) { s3Objects++; s3Bytes += o.size; }
    let files = 0, bytes = 0;
    for await (const f of walkLocal()) { files++; bytes += f.size; }
    return { s3: { configured: !!deps.s3, objects: s3Objects, bytes: s3Bytes }, local: { files, bytes } };
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  async function exportMedia(out: Writable, opts: { createdBy: string | null; isAborted?: () => boolean }) {
    acquireJob('media backup');
    try {
      const skipped: string[] = [];
      const files: ManifestFile[] = [];
      if (deps.s3) {
        for await (const o of deps.s3.list()) {
          if (isSafeRelativePath(o.key)) files.push({ src: 's3', key: o.key, size: o.size });
          else skipped.push(`s3:${o.key}`);
        }
      }
      for await (const f of walkLocal()) files.push({ src: 'local', key: f.key, size: f.size });

      const pack = tar.pack();
      const done = pipelineAsync(pack, out);
      done.catch(() => undefined); // surfaced below through the awaits on pack
      const addBuffer = (name: string, data: Buffer) => new Promise<void>((resolve, reject) => {
        pack.entry({ name, size: data.length }, data, (err) => (err ? reject(err) : resolve()));
      });

      try {
        const manifest: MediaManifest = { type: 'manifest', format: MEDIA_FORMAT, version: MEDIA_VERSION, createdAt: new Date().toISOString(), createdBy: opts.createdBy, files };
        await addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest)));

        let count = 0, bytes = 0;
        const missing: string[] = [];
        for (const f of files) {
          if (opts.isAborted?.()) throw new Error('Media backup cancelled: the client disconnected.');
          const name = `${f.src}/${f.key}`;
          let size: number;
          let body: Readable;
          if (f.src === 's3') {
            const obj = await deps.s3!.get(f.key);
            if (!obj) { missing.push(name); continue; } // deleted after it was listed
            size = obj.size; body = obj.stream;
          } else {
            const full = resolveLocal(f.key);
            let st: fs.Stats | null = null;
            try { st = full ? await fs.promises.stat(full) : null; } catch { /* vanished */ }
            if (!full || !st) { missing.push(name); continue; }
            size = st.size;
            body = fs.createReadStream(full, size ? { start: 0, end: size - 1 } : undefined);
          }
          await new Promise<void>((resolve, reject) => {
            const entry = pack.entry({ name, size }, (err) => (err ? reject(err) : resolve()));
            body.on('error', (e) => { entry.destroy(e); reject(e); });
            body.pipe(entry);
          });
          count++; bytes += size;
        }
        await addBuffer('end.json', Buffer.from(JSON.stringify({ type: 'end', files: count, bytes, missing, skipped })));
        pack.finalize();
        await done;
        return { files: count, bytes, missing: missing.length, skipped: skipped.length };
      } catch (err) {
        pack.destroy(err instanceof Error ? err : undefined);
        throw err;
      }
    } finally {
      releaseJob();
    }
  }

  // ─── Reading an archive ──────────────────────────────────────────────────────

  function openArchive(filePath: string): { entries: tar.Extract; close: () => void } {
    const fd = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(2);
    fs.readSync(fd, magic, 0, 2, 0);
    fs.closeSync(fd);
    const gz = magic[0] === 0x1f && magic[1] === 0x8b;

    const extract = tar.extract();
    const source = fs.createReadStream(filePath);
    const stages: (NodeJS.ReadableStream | NodeJS.WritableStream)[] = [source];
    if (gz) {
      let seen = 0;
      stages.push(zlib.createGunzip(), new Transform({
        transform(chunk, _e, cb) {
          seen += chunk.length;
          if (seen > MAX_UNCOMPRESSED_BYTES) cb(new BackupFileError('The archive expands to an unreasonable size and was rejected.'));
          else cb(null, chunk);
        },
      }));
    }
    stages.push(extract);
    pipeline(stages as never, () => undefined);
    return { entries: extract, close: () => { source.destroy(); extract.destroy(); } };
  }

  const toBackupError = (err: unknown) => {
    if (err instanceof BackupFileError) return err;
    const code = (err as { code?: string })?.code;
    const msg = (err as Error)?.message ?? '';
    if ((typeof code === 'string' && code.startsWith('Z_')) || /invalid tar|unexpected end|Invalid tar/i.test(msg)) {
      return new BackupFileError('The file is not a valid media backup archive (it is corrupted or truncated).');
    }
    return err;
  };

  async function readAll(entry: Readable, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const c of entry) {
      n += (c as Buffer).length;
      if (n > limit) throw new BackupFileError('The archive manifest is unreasonably large.');
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  /** Reads just the manifest, so a wrong file is refused immediately rather than after a long job. */
  async function readManifest(filePath: string): Promise<MediaManifest> {
    const { entries, close } = openArchive(filePath);
    try {
      for await (const entry of entries) {
        if (entry.header.name !== 'manifest.json') {
          entry.resume();
          throw new BackupFileError('This is not a Piitrade media backup (manifest.json is missing).');
        }
        let m: Partial<MediaManifest>;
        try { m = JSON.parse((await readAll(entry as unknown as Readable, MAX_MANIFEST_BYTES)).toString('utf8')); }
        catch (e) { if (e instanceof BackupFileError) throw e; throw new BackupFileError('The media backup manifest is damaged.'); }
        if (m.format !== MEDIA_FORMAT || !Array.isArray(m.files)) throw new BackupFileError('This is not a Piitrade media backup.');
        if (m.version !== MEDIA_VERSION) throw new BackupFileError(`Unsupported media backup version ${String(m.version)}.`);
        return m as MediaManifest;
      }
      throw new BackupFileError('The archive is empty.');
    } catch (err) {
      throw toBackupError(err);
    } finally {
      close();
    }
  }

  // ─── Restore (runs as a background job; the caller polls it) ────────────────

  let current: MediaJob | null = null;
  const getJob = (id?: string) => (current && (!id || current.id === id) ? { ...current, warnings: [...current.warnings] } : null);

  /**
   * Validates the archive, then processes it in the background. Throws BackupFileError for a wrong file
   * and BackupBusyError when another job is running; otherwise returns the job to poll. The staged file
   * is deleted when the job ends (or immediately if it never starts).
   */
  async function startRestore(filePath: string, opts: { mode: MediaRestoreMode; dryRun: boolean }): Promise<MediaJob> {
    acquireJob(opts.dryRun ? 'media restore check' : 'media restore');
    let manifest: MediaManifest;
    try {
      manifest = await readManifest(filePath);
    } catch (err) {
      releaseJob();
      fs.promises.unlink(filePath).catch(() => undefined);
      throw err;
    }
    const job: MediaJob = {
      id: uuidv4(), kind: 'media-restore', state: 'running', dryRun: opts.dryRun, mode: opts.mode,
      backupCreatedAt: manifest.createdAt ?? null, startedAt: new Date().toISOString(), finishedAt: null,
      total: manifest.files.length, processed: 0, written: 0, skipped: 0, unavailable: 0, bytes: 0, warnings: [], error: null,
    };
    current = job;
    runRestore(filePath, manifest, job, opts)
      .then(() => { job.state = 'done'; })
      .catch((err) => {
        job.state = 'failed';
        const e = toBackupError(err);
        job.error = e instanceof Error ? e.message : String(e);
        if (!(e instanceof BackupFileError)) logger.error('Media restore failed', err);
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        releaseJob();
        fs.promises.unlink(filePath).catch(() => undefined);
        logger.info(`Media restore ${job.state}${job.dryRun ? ' (check only)' : ''}: ${job.written} written, ${job.skipped} skipped, ${job.unavailable} unavailable`);
      });
    return { ...job, warnings: [] };
  }

  async function runRestore(filePath: string, manifest: MediaManifest, job: MediaJob, opts: { mode: MediaRestoreMode; dryRun: boolean }) {
    const { entries, close } = openArchive(filePath);
    const inflight = new Set<Promise<void>>();
    let firstError: unknown = null;
    let sawEnd = false;
    let s3Warned = false;

    const track = (p: Promise<void>) => {
      const wrapped = p.catch((e) => { firstError ??= e; }).finally(() => { inflight.delete(wrapped); });
      inflight.add(wrapped);
    };
    const drainAll = async () => { while (inflight.size) await Promise.race(inflight); if (firstError) throw firstError; };
    const throttle = async () => { while (inflight.size >= PARALLEL) await Promise.race(inflight); if (firstError) throw firstError; };

    const existsAt = async (src: 's3' | 'local', key: string): Promise<boolean> => {
      if (src === 's3') return deps.s3!.exists(key);
      const full = resolveLocal(key)!;
      return fs.promises.access(full).then(() => true, () => false);
    };

    const writeTo = async (src: 's3' | 'local', key: string, body: Readable, size: number) => {
      if (src === 's3') return deps.s3!.put(key, body, size);
      const full = resolveLocal(key)!;
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      const tmp = `${full}.restoring-${uuidv4()}`;
      try {
        await pipelineAsync(body, fs.createWriteStream(tmp));
        await fs.promises.rename(tmp, full); // atomic: readers never see a half-written file
      } catch (e) {
        fs.promises.unlink(tmp).catch(() => undefined);
        throw e;
      }
    };

    try {
      for await (const entry of entries) {
        if (firstError) { entry.resume(); throw firstError; }
        const name = entry.header.name;
        if (name === 'manifest.json') { entry.resume(); continue; }
        if (name === 'end.json') { sawEnd = true; entry.resume(); continue; }
        const m = entry.header.type === 'file' ? /^(s3|local)\/(.+)$/.exec(name) : null;
        if (!m) { entry.resume(); continue; }
        const src = m[1] as 's3' | 'local';
        const key = m[2];
        const size = entry.header.size ?? 0;
        job.processed++;

        if (!isSafeRelativePath(key) || (src === 'local' && !resolveLocal(key))) {
          job.warnings.push(`Ignored an unsafe or reserved path: ${name.slice(0, 120)}`);
          job.unavailable++; entry.resume(); continue;
        }
        if (src === 's3' && !deps.s3) {
          if (!s3Warned) { job.warnings.push('The archive contains bucket (S3) files, but S3 is not configured on this server — they were skipped.'); s3Warned = true; }
          job.unavailable++; entry.resume(); continue;
        }

        if (opts.dryRun) {
          entry.resume();
          const exists = opts.mode === 'overwrite' ? false : await existsAt(src, key);
          if (exists) job.skipped++; else { job.written++; job.bytes += size; }
          continue;
        }

        if (opts.mode === 'skip-existing' && (await existsAt(src, key))) { entry.resume(); job.skipped++; continue; }

        if (size <= SMALL_FILE_BYTES) {
          // Small file: buffer it so several can be uploaded at once without stalling the archive reader.
          const buf = await readAll(entry as unknown as Readable, SMALL_FILE_BYTES + 1);
          await throttle();
          track(writeTo(src, key, Readable.from([buf]), buf.length).then(() => { job.written++; job.bytes += buf.length; }));
        } else {
          await drainAll(); // keep ordering simple: big files stream one at a time
          await writeTo(src, key, entry as unknown as Readable, size);
          job.written++; job.bytes += size;
        }
      }
      await drainAll();
      if (!sawEnd) throw new BackupFileError('The archive is incomplete (it ends before the end marker). Files restored so far were kept; run the restore again to finish.');
      if (job.processed !== manifest.files.length) {
        job.warnings.push(`The archive lists ${manifest.files.length} files but holds ${job.processed}; some were not in the archive (deleted while it was being made).`);
      }
    } catch (err) {
      await Promise.allSettled([...inflight]);
      throw err;
    } finally {
      close();
    }
  }

  return { info, exportMedia, startRestore, getJob, readManifest };
}

export type MediaService = ReturnType<typeof createMediaService>;
