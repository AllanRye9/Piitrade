/**
 * Admin → Backup & Restore. Mounted at /api/admin/backup (before the main admin router).
 *
 *   GET  /info       tables + row counts (what a backup would contain)
 *   GET  /download   streams a full database backup (.ndjson.gz; ?compress=0 for plain .ndjson)
 *   POST /restore    multipart: file, mode=merge|replace, dryRun=true|false, confirm=RESTORE
 *
 *   GET  /media/info          what the file storage holds (bucket objects + local uploads)
 *   GET  /media/download      streams every uploaded file as a .tar (?compress=1 for .tar.gz)
 *   POST /media/restore       multipart: mode, dryRun, confirm, then file → starts a background job (202)
 *   GET  /media/jobs/current  progress of the latest media restore / check
 *
 * A backup holds EVERYTHING in the database, including password hashes, KYC records and tokens —
 * it is as sensitive as the database itself. Admin-only, rate-limited and audit-logged.
 */
import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { PassThrough, Writable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { recordAdminAudit } from '../utils/adminAudit';
import { logger } from '../utils/logger';
import { invalidateGeneralSettings } from '../utils/siteSettings';
import { invalidateCategoryCounts } from '../utils/categoryCounts';
import { invalidateHomeLayoutCache } from './homeLayout';
import { BackupBusyError, BackupFileError, exportBackup, getBackupInfo, restoreBackup, type RestoreMode } from '../utils/backup/backupService';
import { createMediaService, type MediaRestoreMode, type MediaService } from '../utils/backup/mediaService';
import { getS3MediaStore } from '../utils/cdn';

const router = Router();

const MAX_UPLOAD_MB = Math.max(1, Number(process.env.BACKUP_MAX_UPLOAD_MB) || 1024);

// Backups hold secrets, so they are staged in the OS temp dir — never under /uploads, which is served publicly.
const stagingDir = path.join(os.tmpdir(), 'piitrade-backup-staging');
fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, stagingDir),
    filename: (_req, _file, cb) => cb(null, `restore-${uuidv4()}.tmp`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const name = file.originalname.toLowerCase();
    if (/\.(ndjson|jsonl|json|gz|backup)$/.test(name)) cb(null, true);
    else cb(new Error('Upload a Piitrade backup file (.ndjson.gz or .ndjson).'));
  },
});

const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.BACKUP_RATE_LIMIT_PER_HOUR) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many backup or restore requests. Try again later.' },
});

router.use(authenticate, authorize('ADMIN'));

const actorOf = (req: Request) => {
  const u = (req as AuthRequest).user;
  return { actorId: u?.userId ?? null, actorEmail: u?.email ?? null };
};

router.get('/info', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ...(await getBackupInfo()), maxUploadMb: MAX_UPLOAD_MB });
  } catch (err) {
    next(err);
  }
});

router.get('/download', backupLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const gzip = req.query.compress !== '0';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `piitrade-backup-${stamp}.${gzip ? 'ndjson.gz' : 'ndjson'}`;

  let gone = false;
  res.on('close', () => { if (!res.writableFinished) gone = true; });

  const sink = gzip ? zlib.createGzip() : new PassThrough();
  sink.on('error', () => { gone = true; });
  const write = (line: string) =>
    new Promise<void>((resolve, reject) => {
      if (gone) return reject(new Error('client disconnected'));
      if (sink.write(line)) return resolve();
      const onDrain = () => { sink.off('close', onClose); resolve(); };
      const onClose = () => { sink.off('drain', onDrain); reject(new Error('stream closed')); };
      sink.once('drain', onDrain);
      sink.once('close', onClose);
    });

  let started = false;
  const startResponse = () => {
    if (started) return;
    started = true;
    res.setHeader('Content-Type', gzip ? 'application/gzip' : 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sink.pipe(res);
  };

  try {
    const { actorId, actorEmail } = actorOf(req);
    const result = await exportBackup(
      async (line) => { startResponse(); await write(line); },
      { createdBy: actorEmail, isAborted: () => gone },
    );
    await new Promise<void>((resolve) => { res.once('finish', resolve); res.once('close', resolve); sink.end(); });
    recordAdminAudit({ action: 'BACKUP_DOWNLOADED', actorId, actorEmail, meta: { ...result, compressed: gzip } })
      .catch((err) => logger.error('Could not audit backup download', err));
  } catch (err) {
    if (!started) return next(err instanceof BackupBusyError ? createError(err.message, 409) : err);
    // Headers are already out: abort the connection so the client sees a failed download, not a
    // plausible-looking truncated file (which a restore would refuse anyway — it has no end marker).
    logger.error('Backup export failed mid-stream', err);
    res.destroy(err instanceof Error ? err : undefined);
  }
});

router.post(
  '/restore',
  backupLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return next(createError(err.code === 'LIMIT_FILE_SIZE' ? `The file is larger than the ${MAX_UPLOAD_MB} MB upload limit.` : err.message, 400));
      }
      next(createError(err instanceof Error ? err.message : 'Upload failed', 400));
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    try {
      if (!file) throw createError('Choose a backup file to upload.', 400);
      const mode = String(req.body?.mode ?? 'merge') as RestoreMode;
      if (mode !== 'merge' && mode !== 'replace') throw createError('mode must be "merge" or "replace".', 400);
      const dryRun = String(req.body?.dryRun ?? 'false') === 'true';
      if (!dryRun && mode === 'replace' && req.body?.confirm !== 'RESTORE') {
        throw createError('Replacing all data requires typing RESTORE to confirm.', 400);
      }

      const report = await restoreBackup(file.path, { mode, dryRun });

      if (!dryRun) {
        // The database changed underneath every in-memory cache.
        invalidateGeneralSettings();
        invalidateCategoryCounts();
        invalidateHomeLayoutCache();
        const { actorId, actorEmail } = actorOf(req);
        recordAdminAudit({
          action: 'BACKUP_RESTORED', actorId, actorEmail,
          meta: { mode, fileName: file.originalname, backupCreatedAt: report.backupCreatedAt, ...report.totals },
        }).catch((err) => logger.error('Could not audit backup restore', err));
      }
      res.json(report);
    } catch (err) {
      if (err instanceof BackupFileError) return next(createError(err.message, 400));
      if (err instanceof BackupBusyError) return next(createError(err.message, 409));
      if (err instanceof Error && !(err as { statusCode?: number }).statusCode) {
        logger.error('Backup restore failed', err);
        // A database error rolled the whole restore back; say so, with the database's reason (admin-only).
        return next(createError(`The restore failed and every change was rolled back. Reason: ${err.message.replace(/\s+/g, ' ').slice(0, 400)}`, 422));
      }
      next(err);
    } finally {
      if (file) fs.promises.unlink(file.path).catch(() => undefined);
    }
  },
);

// ─── Media files (images, videos, documents) ───────────────────────────────────

let mediaSvc: MediaService | null = null;
const media = () => (mediaSvc ??= createMediaService({ s3: getS3MediaStore(), uploadsRoot: path.resolve(process.cwd(), 'uploads') }));

const MAX_MEDIA_UPLOAD_MB = Math.max(1, Number(process.env.BACKUP_MAX_MEDIA_UPLOAD_MB) || 4096);

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, stagingDir),
    filename: (_req, _file, cb) => cb(null, `media-restore-${uuidv4()}.tmp`),
  }),
  limits: { fileSize: MAX_MEDIA_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (/\.(tar|tar\.gz|tgz|gz)$/.test(file.originalname.toLowerCase())) cb(null, true);
    else cb(new Error('Upload a Piitrade media backup (.tar or .tar.gz).'));
  },
});

router.get('/media/info', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ ...(await media().info()), maxUploadMb: MAX_MEDIA_UPLOAD_MB });
  } catch (err) {
    next(err);
  }
});

router.get('/media/download', backupLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const gzip = req.query.compress === '1';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `piitrade-media-${stamp}.${gzip ? 'tar.gz' : 'tar'}`;

  let gone = false;
  res.on('close', () => { if (!res.writableFinished) gone = true; });

  // Headers are only sent when the first byte is written, so a failure before that (e.g. another job is
  // running) can still be reported as a normal JSON error.
  let started = false;
  const target: Writable = gzip ? zlib.createGzip() : res;
  if (gzip) (target as zlib.Gzip).pipe(res);
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!started) {
        started = true;
        res.setHeader('Content-Type', gzip ? 'application/gzip' : 'application/x-tar');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
      if (target.write(chunk)) cb(); else target.once('drain', () => cb());
    },
    final(cb) { target.end(); cb(); },
  });
  res.on('close', () => { if (!res.writableFinished) out.destroy(); });

  try {
    const { actorId, actorEmail } = actorOf(req);
    const result = await media().exportMedia(out, { createdBy: actorEmail, isAborted: () => gone });
    recordAdminAudit({ action: 'MEDIA_BACKUP_DOWNLOADED', actorId, actorEmail, meta: { ...result, compressed: gzip } })
      .catch((err) => logger.error('Could not audit media backup', err));
  } catch (err) {
    if (!started) {
      if (gzip) (target as zlib.Gzip).destroy(); // nothing was sent: don't leave the compressor piped to res
      return next(err instanceof BackupBusyError ? createError(err.message, 409) : err);
    }
    logger.error('Media backup failed mid-stream', err);
    res.destroy(err instanceof Error ? err : undefined); // a clearly failed download, never a plausible truncated one
  }
});

router.post(
  '/media/restore',
  backupLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    mediaUpload.single('file')(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        return next(createError(err.code === 'LIMIT_FILE_SIZE' ? `The file is larger than the ${MAX_MEDIA_UPLOAD_MB} MB upload limit.` : err.message, 400));
      }
      next(createError(err instanceof Error ? err.message : 'Upload failed', 400));
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    let handedOver = false; // once the job is running it deletes the staged file itself
    try {
      if (!file) throw createError('Choose a media backup file to upload.', 400);
      const mode = String(req.body?.mode ?? 'skip-existing') as MediaRestoreMode;
      if (mode !== 'skip-existing' && mode !== 'overwrite') throw createError('mode must be "skip-existing" or "overwrite".', 400);
      const dryRun = String(req.body?.dryRun ?? 'false') === 'true';
      if (!dryRun && mode === 'overwrite' && req.body?.confirm !== 'RESTORE') {
        throw createError('Overwriting existing files requires typing RESTORE to confirm.', 400);
      }
      // Only after startRestore resolves does the job own the file. If it throws (another job is running,
      // wrong archive…) the staged upload — up to several GB — must still be removed by the finally below.
      const job = await media().startRestore(file.path, { mode, dryRun });
      handedOver = true;
      if (!dryRun) {
        const { actorId, actorEmail } = actorOf(req);
        recordAdminAudit({ action: 'MEDIA_RESTORE_STARTED', actorId, actorEmail, meta: { mode, fileName: file.originalname, files: job.total } })
          .catch((err) => logger.error('Could not audit media restore', err));
      }
      res.status(202).json(job);
    } catch (err) {
      if (err instanceof BackupFileError) return next(createError(err.message, 400));
      if (err instanceof BackupBusyError) return next(createError(err.message, 409));
      next(err);
    } finally {
      if (file && !handedOver) fs.promises.unlink(file.path).catch(() => undefined);
    }
  },
);

router.get('/media/jobs/current', (_req: Request, res: Response) => {
  res.json({ job: media().getJob() });
});

export default router;
