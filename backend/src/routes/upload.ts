import { safeExtension } from '../utils/uploadGuard';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { prisma } from '../utils/prisma';
import { uploadToCDN, deleteFromCDN, isS3Configured, streamFromS3 } from '../utils/cdn';
import { optimizeImageInPlace } from '../utils/imageOptimize';
import { fingerprintBuffer, findVisualMatches, warmFingerprintCache, type VisualMatch } from '../utils/imageFingerprint';
import { logger } from '../utils/logger';
import { rateLimit } from 'express-rate-limit';

const router = Router();

// Ensure temp uploads directory exists (not publicly listed, UUID filenames)
const tempUploadsDir = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(tempUploadsDir)) {
  fs.mkdirSync(tempUploadsDir, { recursive: true });
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    cb(null, tempUploadsDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = safeExtension(file.originalname, file.mimetype);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, GIF, and WEBP files are allowed'));
      return;
    }
    cb(null, true);
  },
});

router.post(
  '/',
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    upload.array('images', 10)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(createError(err.message, 400));
      } else if (err) {
        return next(createError((err as Error).message || 'Upload failed', 400));
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ message: 'No files uploaded' });
        return;
      }

      // Optional folder params for category/country-based S3 organisation.
      // Callers may pass these as query params or body fields.
      const country = ((req.body?.country || req.query?.country) as string | undefined)?.toUpperCase().replace(/[^A-Z0-9_]/g, '') || '';
      const categorySlug = ((req.body?.categorySlug || req.query?.categorySlug) as string | undefined)?.replace(/[^a-z0-9-_]/gi, '') || '';
      const folder = country && categorySlug ? `${country}/${categorySlug}` : country || undefined;

      // Upload each file to CDN immediately so images are persisted in the
      // bucket regardless of admin approval status. The ProductImage record
      // is still created as PENDING so admins can review/reject later.
      // Upload original images at full resolution — no watermark applied.
      const results: { id: string; url: string }[] = [];
      for (const f of files) {
        const tempFilePath = path.join(tempUploadsDir, f.filename);
        let cdnUrl: string;
        try {
          await optimizeImageInPlace(tempFilePath);
          cdnUrl = await uploadToCDN(tempFilePath, f.filename, folder);
        } finally {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (cleanupErr) {
            logger.warn(`Failed to remove temp upload file "${f.filename}": ${String(cleanupErr)}`);
          }
        }

        const isAdmin = req.user!.role === 'ADMIN';

        const record = await prisma.productImage.create({
          data: {
            sellerId: req.user!.userId,
            tempPath: f.filename,
            cdnUrl, // store CDN URL immediately
            // Admins bypass the approval workflow — their images are approved immediately.
            status: isAdmin ? 'APPROVED' : 'PENDING',
          },
        });
        results.push({ id: record.id, url: cdnUrl });
      }

      const imageIds = results.map((r) => r.id);
      const urls = results.map((r) => r.url);

      res.json({ imageIds, urls });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Wholesale/Bulk Commodity Marketplace: short video upload ─────────────
// Powers the optional showcase clip on the merged /market-prices wholesale
// posting form (see backend/src/routes/farmerMarketplace.ts). Duration
// (< 60 seconds) is enforced client-side by reading the video element's
// metadata before this endpoint is ever called — there is no ffprobe/media
// tooling in this stack to re-verify duration server-side, so the file-size
// cap below is a practical proxy limit, not a true duration check. Mirrors
// the existing admin promo-video multer setup in routes/admin.ts (same
// allowed mime types), scoped to its own router/storage so it can never
// affect the image-only upload above.
const videoStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    cb(null, tempUploadsDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = safeExtension(file.originalname, file.mimetype);
    cb(null, `wm-video-${uuidv4()}${ext}`);
  },
});

const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
// A well-compressed 60-second clip at reasonable quality comfortably fits
// well under this; it is a generous ceiling, not an endorsement of longer
// videos slipping through — the client blocks anything over 60s before it
// ever reaches this endpoint.
const MAX_VIDEO_FILE_SIZE = 40 * 1024 * 1024; // 40 MB

const videoUploadMw = multer({
  storage: videoStorage,
  limits: { fileSize: MAX_VIDEO_FILE_SIZE },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error('Only MP4, WEBM, and MOV video files are allowed'));
      return;
    }
    cb(null, true);
  },
});

router.post(
  '/video',
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    videoUploadMw.single('video')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(createError(err.message, 400));
      } else if (err) {
        return next(createError((err as Error).message || 'Upload failed', 400));
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) return next(createError('No video file uploaded', 400));

      const tempFilePath = path.join(tempUploadsDir, file.filename);
      let cdnUrl: string;
      try {
        cdnUrl = await uploadToCDN(tempFilePath, file.filename, 'wholesale-videos');
      } finally {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupErr) {
          logger.warn(`Failed to remove temp video upload "${file.filename}": ${String(cleanupErr)}`);
        }
      }

      res.json({ url: cdnUrl });
    } catch (err) {
      next(err);
    }
  },
);

// Avatar upload endpoint — uploads a single profile photo directly to CDN
// and returns the CDN URL immediately (no admin approval needed for avatars).
const avatarStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    cb(null, tempUploadsDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = safeExtension(file.originalname, file.mimetype);
    cb(null, `avatar-${uuidv4()}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed'));
      return;
    }
    cb(null, true);
  },
});

router.post(
  '/avatar',
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    avatarUpload.single('image')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(createError(err.message, 400));
      } else if (err) {
        return next(createError((err as Error).message || 'Upload failed', 400));
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return next(createError('No file uploaded', 400));
      }
      const tempFilePath = path.join(tempUploadsDir, file.filename);
      let cdnUrl: string;
      try {
        // Avatars are displayed small everywhere (nav, cards, profile
        // header) — cap them tighter than listing photos.
        await optimizeImageInPlace(tempFilePath, { maxDimension: 800, quality: 85 });
        cdnUrl = await uploadToCDN(tempFilePath, file.filename);
      } finally {
        // Always clean up the temp file
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // best-effort cleanup
        }
      }
      res.json({ urls: [cdnUrl] });
    } catch (err) {
      next(err);
    }
  },
);

// ─── KYC Document Upload (ID document / selfie) ────────────────────────────────
// Mirrors the avatar upload pattern: straight to CDN, no ProductImage record
// (so it never lands in the public product-image moderation queue) and no
// UserDocument record (so it never appears in the seller's public
// CV/certificates list) — these are private identity documents reviewed only
// by admins via /api/kyc and /admin/kyc.

const kycStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    cb(null, tempUploadsDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = safeExtension(file.originalname, file.mimetype);
    cb(null, `kyc-${uuidv4()}${ext}`);
  },
});

const kycUpload = multer({
  storage: kycStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
      return;
    }
    cb(null, true);
  },
});

router.post(
  '/kyc-document',
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    kycUpload.single('image')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(createError(err.message, 400));
      } else if (err) {
        return next(createError((err as Error).message || 'Upload failed', 400));
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return next(createError('No file uploaded', 400));
      }
      const tempFilePath = path.join(tempUploadsDir, file.filename);
      let cdnUrl: string;
      try {
        cdnUrl = await uploadToCDN(tempFilePath, file.filename, 'kyc');
      } finally {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // best-effort cleanup
        }
      }
      res.json({ url: cdnUrl });
    } catch (err) {
      next(err);
    }
  },
);

// ─── User Document Upload (CV, Certificates, etc.) ────────────────────────────

const documentStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    cb(null, tempUploadsDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = safeExtension(file.originalname, file.mimetype);
    cb(null, `doc-${uuidv4()}${ext}`);
  },
});

const ALLOWED_DOC_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const documentUpload = multer({
  storage: documentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!ALLOWED_DOC_MIMES.includes(file.mimetype)) {
      cb(new Error('Only PDF, DOC, DOCX, and image files are allowed'));
      return;
    }
    cb(null, true);
  },
});

// POST /upload/document — upload a CV / certificate / portfolio file
router.post(
  '/document',
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    documentUpload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(createError(err.message, 400));
      } else if (err) {
        return next(createError((err as Error).message || 'Upload failed', 400));
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return next(createError('No file uploaded', 400));
      }

      const { type = 'OTHER', title, description, isPublic } = req.body;
      if (!title || !title.trim()) {
        return next(createError('Document title is required', 400));
      }

      const allowedTypes = ['CV', 'CERTIFICATE', 'PORTFOLIO', 'OTHER'];
      const docType = allowedTypes.includes(type) ? type : 'OTHER';

      // Private by default: a document is public only when explicitly set to 'true' / true.
      const isPublicBool = isPublic === 'true' || isPublic === true;

      const tempFilePath = path.join(tempUploadsDir, file.filename);
      let fileUrl: string;
      try {
        // Stored under a dedicated "documents" folder (as opposed to the flat
        // namespace used for listing/product images) so the public image
        // proxy and the raw static /uploads mount can both refuse to serve
        // this prefix — document content is only ever served through the
        // authenticated GET /documents/:id/file route below.
        fileUrl = await uploadToCDN(tempFilePath, file.filename, 'documents');
      } finally {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // best-effort cleanup
        }
      }

      const doc = await prisma.userDocument.create({
        data: {
          userId: req.user!.userId,
          type: docType,
          title: title.trim(),
          description: description?.trim() || null,
          fileUrl,
          fileName: file.originalname,
          fileSize: file.size,
          isPublic: isPublicBool,
        },
      });

      res.status(201).json({ document: doc });
    } catch (err) {
      next(err);
    }
  },
);

// Document content types. Kept separate from the public /api/images proxy's
// content-type map on purpose — that route is unauthenticated, so it should
// stay scoped to image/video assets only and never learn to serve PDFs/DOCs.
const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// Recovers the underlying storage key from a document's stored `fileUrl`,
// which is always one of the two relative-path shapes `uploadToCDN` returns:
// "/api/images/<encodedKey>" (S3) or "/uploads/<path>" (local fallback).
// Mirrors the parsing already used by deleteFromCDN.
function extractStorageKey(fileUrl: string): string | null {
  const imageProxyMarker = '/api/images/';
  const uploadsMarker = '/uploads/';

  const proxyIdx = fileUrl.indexOf(imageProxyMarker);
  if (proxyIdx >= 0) {
    const encoded = fileUrl.slice(proxyIdx + imageProxyMarker.length);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }

  const uploadsIdx = fileUrl.indexOf(uploadsMarker);
  if (uploadsIdx >= 0) return fileUrl.slice(uploadsIdx + uploadsMarker.length);

  return null;
}

// GET /upload/kyc-file?url=<stored kyc url> — authenticated KYC image streaming.
// Only admins, or the user whose own KYC fields reference this exact file, may read it.
const KYC_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
router.get('/kyc-file', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    const key = url ? extractStorageKey(url) : null;
    if (!key || key.includes('..') || path.isAbsolute(key) || key.split('/')[0] !== 'kyc') {
      return next(createError('File not found', 404));
    }
    const contentType = KYC_CONTENT_TYPES[path.extname(key).toLowerCase()];
    if (!contentType) return next(createError('File not found', 404));

    if (req.user!.role !== 'ADMIN') {
      const base = path.basename(key);
      const owner = await prisma.user.findFirst({
        where: {
          id: req.user!.userId,
          OR: [
            { kycDocumentUrl: { contains: base } }, { kycDocumentBackUrl: { contains: base } }, { kycSelfieUrl: { contains: base } },
            { kycDraftDocumentUrl: { contains: base } }, { kycDraftDocumentBackUrl: { contains: base } }, { kycDraftSelfieUrl: { contains: base } },
          ],
        },
        select: { id: true },
      });
      if (!owner) return next(createError('Not authorised', 403));
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    if (isS3Configured()) {
      try {
        const stream = await streamFromS3(key);
        stream.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
        stream.pipe(res);
        return;
      } catch (err) {
        logger.warn(`S3 stream failed for KYC file, trying local: ${String(err)}`);
      }
    }
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const localPath = path.join(uploadsDir, key);
    if (!localPath.startsWith(uploadsDir + path.sep) || !fs.existsSync(localPath)) return next(createError('File not found', 404));
    const rs = fs.createReadStream(localPath);
    rs.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
    rs.pipe(res);
  } catch (err) {
    next(err);
  }
});

// GET /upload/documents/:id/file — stream a document's actual file content.
//
// Unlike the public /api/images proxy (which has no auth and will serve any
// storage key handed to it), this route checks who is asking BEFORE it
// streams anything: the owner, an admin, or anyone when the document is
// marked public. A leaked/guessed storage key alone is no longer enough to
// read a private document — the frontend document viewers should link here
// instead of directly to `fileUrl`.
router.get('/documents/:id/file', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.userDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return next(createError('Document not found', 404));

    // A CV is private: only its owner, an admin, or the poster of a job the
    // owner APPLIED to with this CV may open it. (`isPublic` no longer exposes
    // CVs — they are shared exclusively through job applications.)
    let allowed = doc.userId === req.user!.userId
      || req.user!.role === 'ADMIN'
      || (doc.type !== 'CV' && doc.isPublic);
    if (!allowed && doc.type === 'CV') {
      const sharedWithMe = await prisma.jobApplication.findFirst({
        where: { documentId: doc.id, job: { postedById: req.user!.userId } },
        select: { id: true },
      });
      allowed = Boolean(sharedWithMe);
    }
    if (!allowed) return next(createError('Not authorised', 403));

    const key = extractStorageKey(doc.fileUrl);
    if (!key || key.includes('..') || path.isAbsolute(key)) {
      return next(createError('File not available', 404));
    }

    const ext = path.extname(key).toLowerCase();
    const contentType = DOCUMENT_CONTENT_TYPES[ext] || 'application/octet-stream';
    const safeFileName = (doc.fileName || 'document').replace(/[\r\n"]/g, '');

    if (isS3Configured()) {
      try {
        const stream = await streamFromS3(key);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFileName)}"`);
        // Streams emit 'error' asynchronously — a mid-transfer failure here
        // would otherwise be an unhandled event that can crash the process.
        stream.on('error', (streamErr) => {
          logger.error(`S3 stream errored mid-transfer for document "${doc.id}"`, streamErr);
          if (!res.headersSent) {
            res.status(502).json({ message: 'Failed to stream document' });
          } else {
            res.destroy();
          }
        });
        stream.pipe(res);
        return;
      } catch (err) {
        logger.warn(`S3 stream failed for document "${doc.id}", trying local: ${String(err)}`);
      }
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    const localPath = path.join(uploadsDir, key);
    if (!localPath.startsWith(uploadsDir + path.sep) && localPath !== uploadsDir) {
      return next(createError('File not available', 404));
    }
    if (!fs.existsSync(localPath)) return next(createError('File not found', 404));

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFileName)}"`);
    const readStream = fs.createReadStream(localPath);
    readStream.on('error', (streamErr) => {
      logger.error(`Local file stream errored for document "${doc.id}"`, streamErr);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Failed to read document' });
      } else {
        res.destroy();
      }
    });
    readStream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// GET /upload/documents — list the caller's documents
router.get('/documents', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const docs = await prisma.userDocument.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

// DELETE /upload/documents/:id — delete a document
router.delete('/documents/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.userDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) {
      return next(createError('Document not found', 404));
    }
    if (doc.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      return next(createError('Not authorised', 403));
    }
    await deleteFromCDN(doc.fileUrl);
    await prisma.userDocument.delete({ where: { id: req.params.id } });
    res.json({ message: 'Document deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /upload/documents/user/:userId — list public documents for a user (job market)
router.get('/documents/user/:userId', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // No public browsing of anyone's documents — owner or admin only.
    if (req.params.userId !== req.user!.userId && req.user!.role !== 'ADMIN') {
      return next(createError('Not authorised', 403));
    }
    const docs = await prisma.userDocument.findMany({
      where: { userId: req.params.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

// GET /upload/candidates — admin-only. The public candidate/CV directory on /jobs was removed:
// CVs reach recruiters only through job applications.
router.get('/candidates', authenticate, authorize('ADMIN'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20', q = '' } = req.query as Record<string, string>;
    const pg = Math.max(1, parseInt(page, 10));
    const lim = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pg - 1) * lim;

    const whereUser = q.trim()
      ? { name: { contains: q.trim(), mode: 'insensitive' as const } }
      : {};

    const [total, candidates] = await Promise.all([
      prisma.user.count({
        where: {
          ...whereUser,
          documents: { some: { isPublic: true, type: 'CV' } },
        },
      }),
      prisma.user.findMany({
        where: {
          ...whereUser,
          documents: { some: { isPublic: true, type: 'CV' } },
        },
        select: {
          id: true,
          name: true,
          avatar: true,
          country: true,
          createdAt: true,
          documents: {
            where: { isPublic: true, type: { not: 'CV' } },
            select: { id: true, type: true, title: true, description: true, createdAt: true }, // never storage URLs
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
        skip,
        take: lim,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      candidates,
      total,
      page: pg,
      pages: Math.ceil(total / lim),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Image search (public) ───────────────────────────────────────────────────
// Visitors can search by photo without an account. The image-AI worker can only
// read a publicly reachable URL, so the photo is stored briefly under a temp
// folder, the URL is returned, and the file is deleted ~15 minutes later. No DB
// record is created. Tightly rate-limited because it is unauthenticated.
const imageSearchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many photo searches. Please wait a few minutes and try again.' },
});

router.post(
  '/search',
  imageSearchLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('image')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) return next(createError(err.message, 400));
      if (err) return next(createError((err as Error).message || 'Upload failed', 400));
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    const f = req.file;
    try {
      if (!f) {
        res.status(400).json({ message: 'No image uploaded' });
        return;
      }
      const tempFilePath = path.join(tempUploadsDir, f.filename);
      let url: string;
      let matches: VisualMatch[] = [];
      try {
        await optimizeImageInPlace(tempFilePath);
        // Method 2 of photo search: visual fingerprint match against listing
        // photos. Best-effort — never allowed to break the upload itself.
        try {
          const fp = await fingerprintBuffer(fs.readFileSync(tempFilePath));
          matches = await findVisualMatches(fp);
          warmFingerprintCache();
        } catch (e) {
          logger.warn(`visual match failed: ${String(e)}`);
        }
        url = await uploadToCDN(tempFilePath, f.filename, 'search-temp');
      } finally {
        try { fs.unlinkSync(tempFilePath); } catch { /* already gone */ }
      }
      const timer = setTimeout(() => {
        deleteFromCDN(url).catch((e) => logger.warn(`image-search cleanup failed: ${String(e)}`));
      }, 15 * 60 * 1000);
      timer.unref?.();
      res.json({ url, matches });
    } catch (err) {
      next(err);
    }
  }
);

export default router;