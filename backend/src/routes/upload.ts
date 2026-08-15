import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { prisma } from '../utils/prisma';
import { uploadToCDN, deleteFromCDN, isS3Configured, streamFromS3 } from '../utils/cdn';
import { logger } from '../utils/logger';

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
    const ext = path.extname(file.originalname).toLowerCase();
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

// Avatar upload endpoint — uploads a single profile photo directly to CDN
// and returns the CDN URL immediately (no admin approval needed for avatars).
const avatarStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    cb(null, tempUploadsDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
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

// ─── User Document Upload (CV, Certificates, etc.) ────────────────────────────

const documentStorage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    cb(null, tempUploadsDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
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

      // Treat isPublic as true unless explicitly set to 'false' or false (boolean)
      const isPublicBool = isPublic === 'false' || isPublic === false ? false : true;

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

    const allowed = doc.isPublic || doc.userId === req.user!.userId || req.user!.role === 'ADMIN';
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
    const docs = await prisma.userDocument.findMany({
      where: { userId: req.params.userId, isPublic: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

// GET /upload/candidates — authenticated list of users who have public CV documents
router.get('/candidates', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
            where: { isPublic: true },
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

export default router;