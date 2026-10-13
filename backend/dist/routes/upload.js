"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const auth_1 = require("../middleware/auth");
const errorHandler_1 = require("../middleware/errorHandler");
const prisma_1 = require("../utils/prisma");
const cdn_1 = require("../utils/cdn");
const imageOptimize_1 = require("../utils/imageOptimize");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
// Ensure temp uploads directory exists (not publicly listed, UUID filenames)
const tempUploadsDir = path_1.default.join(process.cwd(), 'uploads', 'temp');
if (!fs_1.default.existsSync(tempUploadsDir)) {
    fs_1.default.mkdirSync(tempUploadsDir, { recursive: true });
}
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, tempUploadsDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        cb(null, `${(0, uuid_1.v4)()}${ext}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(new Error('Only JPEG, PNG, GIF, and WEBP files are allowed'));
            return;
        }
        cb(null, true);
    },
});
router.post('/', auth_1.authenticate, (req, res, next) => {
    upload.array('images', 10)(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            res.status(400).json({ message: 'No files uploaded' });
            return;
        }
        // Optional folder params for category/country-based S3 organisation.
        // Callers may pass these as query params or body fields.
        const country = (req.body?.country || req.query?.country)?.toUpperCase().replace(/[^A-Z0-9_]/g, '') || '';
        const categorySlug = (req.body?.categorySlug || req.query?.categorySlug)?.replace(/[^a-z0-9-_]/gi, '') || '';
        const folder = country && categorySlug ? `${country}/${categorySlug}` : country || undefined;
        // Upload each file to CDN immediately so images are persisted in the
        // bucket regardless of admin approval status. The ProductImage record
        // is still created as PENDING so admins can review/reject later.
        // Upload original images at full resolution — no watermark applied.
        const results = [];
        for (const f of files) {
            const tempFilePath = path_1.default.join(tempUploadsDir, f.filename);
            let cdnUrl;
            try {
                await (0, imageOptimize_1.optimizeImageInPlace)(tempFilePath);
                cdnUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, f.filename, folder);
            }
            finally {
                try {
                    fs_1.default.unlinkSync(tempFilePath);
                }
                catch (cleanupErr) {
                    logger_1.logger.warn(`Failed to remove temp upload file "${f.filename}": ${String(cleanupErr)}`);
                }
            }
            const isAdmin = req.user.role === 'ADMIN';
            const record = await prisma_1.prisma.productImage.create({
                data: {
                    sellerId: req.user.userId,
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
    }
    catch (err) {
        next(err);
    }
});
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
const videoStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, tempUploadsDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase() || '.mp4';
        cb(null, `wm-video-${(0, uuid_1.v4)()}${ext}`);
    },
});
const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
// A well-compressed 60-second clip at reasonable quality comfortably fits
// well under this; it is a generous ceiling, not an endorsement of longer
// videos slipping through — the client blocks anything over 60s before it
// ever reaches this endpoint.
const MAX_VIDEO_FILE_SIZE = 40 * 1024 * 1024; // 40 MB
const videoUploadMw = (0, multer_1.default)({
    storage: videoStorage,
    limits: { fileSize: MAX_VIDEO_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.mimetype)) {
            cb(new Error('Only MP4, WEBM, and MOV video files are allowed'));
            return;
        }
        cb(null, true);
    },
});
router.post('/video', auth_1.authenticate, (req, res, next) => {
    videoUploadMw.single('video')(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const file = req.file;
        if (!file)
            return next((0, errorHandler_1.createError)('No video file uploaded', 400));
        const tempFilePath = path_1.default.join(tempUploadsDir, file.filename);
        let cdnUrl;
        try {
            cdnUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, file.filename, 'wholesale-videos');
        }
        finally {
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch (cleanupErr) {
                logger_1.logger.warn(`Failed to remove temp video upload "${file.filename}": ${String(cleanupErr)}`);
            }
        }
        res.json({ url: cdnUrl });
    }
    catch (err) {
        next(err);
    }
});
// Avatar upload endpoint — uploads a single profile photo directly to CDN
// and returns the CDN URL immediately (no admin approval needed for avatars).
const avatarStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, tempUploadsDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `avatar-${(0, uuid_1.v4)()}${ext}`);
    },
});
const avatarUpload = (0, multer_1.default)({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowed.includes(file.mimetype)) {
            cb(new Error('Only JPEG, PNG, WEBP, or GIF images are allowed'));
            return;
        }
        cb(null, true);
    },
});
router.post('/avatar', auth_1.authenticate, (req, res, next) => {
    avatarUpload.single('image')(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return next((0, errorHandler_1.createError)('No file uploaded', 400));
        }
        const tempFilePath = path_1.default.join(tempUploadsDir, file.filename);
        let cdnUrl;
        try {
            // Avatars are displayed small everywhere (nav, cards, profile
            // header) — cap them tighter than listing photos.
            await (0, imageOptimize_1.optimizeImageInPlace)(tempFilePath, { maxDimension: 800, quality: 85 });
            cdnUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, file.filename);
        }
        finally {
            // Always clean up the temp file
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch {
                // best-effort cleanup
            }
        }
        res.json({ urls: [cdnUrl] });
    }
    catch (err) {
        next(err);
    }
});
// ─── KYC Document Upload (ID document / selfie) ────────────────────────────────
// Mirrors the avatar upload pattern: straight to CDN, no ProductImage record
// (so it never lands in the public product-image moderation queue) and no
// UserDocument record (so it never appears in the seller's public
// CV/certificates list) — these are private identity documents reviewed only
// by admins via /api/kyc and /admin/kyc.
const kycStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, tempUploadsDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `kyc-${(0, uuid_1.v4)()}${ext}`);
    },
});
const kycUpload = (0, multer_1.default)({
    storage: kycStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
            cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
            return;
        }
        cb(null, true);
    },
});
router.post('/kyc-document', auth_1.authenticate, (req, res, next) => {
    kycUpload.single('image')(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return next((0, errorHandler_1.createError)('No file uploaded', 400));
        }
        const tempFilePath = path_1.default.join(tempUploadsDir, file.filename);
        let cdnUrl;
        try {
            cdnUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, file.filename, 'kyc');
        }
        finally {
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch {
                // best-effort cleanup
            }
        }
        res.json({ url: cdnUrl });
    }
    catch (err) {
        next(err);
    }
});
// ─── User Document Upload (CV, Certificates, etc.) ────────────────────────────
const documentStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, tempUploadsDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase() || '.pdf';
        cb(null, `doc-${(0, uuid_1.v4)()}${ext}`);
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
const documentUpload = (0, multer_1.default)({
    storage: documentStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_DOC_MIMES.includes(file.mimetype)) {
            cb(new Error('Only PDF, DOC, DOCX, and image files are allowed'));
            return;
        }
        cb(null, true);
    },
});
// POST /upload/document — upload a CV / certificate / portfolio file
router.post('/document', auth_1.authenticate, (req, res, next) => {
    documentUpload.single('file')(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return next((0, errorHandler_1.createError)(err.message, 400));
        }
        else if (err) {
            return next((0, errorHandler_1.createError)(err.message || 'Upload failed', 400));
        }
        next();
    });
}, async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return next((0, errorHandler_1.createError)('No file uploaded', 400));
        }
        const { type = 'OTHER', title, description, isPublic } = req.body;
        if (!title || !title.trim()) {
            return next((0, errorHandler_1.createError)('Document title is required', 400));
        }
        const allowedTypes = ['CV', 'CERTIFICATE', 'PORTFOLIO', 'OTHER'];
        const docType = allowedTypes.includes(type) ? type : 'OTHER';
        // Treat isPublic as true unless explicitly set to 'false' or false (boolean)
        const isPublicBool = isPublic === 'false' || isPublic === false ? false : true;
        const tempFilePath = path_1.default.join(tempUploadsDir, file.filename);
        let fileUrl;
        try {
            // Stored under a dedicated "documents" folder (as opposed to the flat
            // namespace used for listing/product images) so the public image
            // proxy and the raw static /uploads mount can both refuse to serve
            // this prefix — document content is only ever served through the
            // authenticated GET /documents/:id/file route below.
            fileUrl = await (0, cdn_1.uploadToCDN)(tempFilePath, file.filename, 'documents');
        }
        finally {
            try {
                fs_1.default.unlinkSync(tempFilePath);
            }
            catch {
                // best-effort cleanup
            }
        }
        const doc = await prisma_1.prisma.userDocument.create({
            data: {
                userId: req.user.userId,
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
    }
    catch (err) {
        next(err);
    }
});
// Document content types. Kept separate from the public /api/images proxy's
// content-type map on purpose — that route is unauthenticated, so it should
// stay scoped to image/video assets only and never learn to serve PDFs/DOCs.
const DOCUMENT_CONTENT_TYPES = {
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
function extractStorageKey(fileUrl) {
    const imageProxyMarker = '/api/images/';
    const uploadsMarker = '/uploads/';
    const proxyIdx = fileUrl.indexOf(imageProxyMarker);
    if (proxyIdx >= 0) {
        const encoded = fileUrl.slice(proxyIdx + imageProxyMarker.length);
        try {
            return decodeURIComponent(encoded);
        }
        catch {
            return null;
        }
    }
    const uploadsIdx = fileUrl.indexOf(uploadsMarker);
    if (uploadsIdx >= 0)
        return fileUrl.slice(uploadsIdx + uploadsMarker.length);
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
router.get('/documents/:id/file', auth_1.authenticate, async (req, res, next) => {
    try {
        const doc = await prisma_1.prisma.userDocument.findUnique({ where: { id: req.params.id } });
        if (!doc)
            return next((0, errorHandler_1.createError)('Document not found', 404));
        // A CV is private: only its owner, an admin, or the poster of a job the
        // owner APPLIED to with this CV may open it. (`isPublic` no longer exposes
        // CVs — they are shared exclusively through job applications.)
        let allowed = doc.userId === req.user.userId
            || req.user.role === 'ADMIN'
            || (doc.type !== 'CV' && doc.isPublic);
        if (!allowed && doc.type === 'CV') {
            const sharedWithMe = await prisma_1.prisma.jobApplication.findFirst({
                where: { documentId: doc.id, job: { postedById: req.user.userId } },
                select: { id: true },
            });
            allowed = Boolean(sharedWithMe);
        }
        if (!allowed)
            return next((0, errorHandler_1.createError)('Not authorised', 403));
        const key = extractStorageKey(doc.fileUrl);
        if (!key || key.includes('..') || path_1.default.isAbsolute(key)) {
            return next((0, errorHandler_1.createError)('File not available', 404));
        }
        const ext = path_1.default.extname(key).toLowerCase();
        const contentType = DOCUMENT_CONTENT_TYPES[ext] || 'application/octet-stream';
        const safeFileName = (doc.fileName || 'document').replace(/[\r\n"]/g, '');
        if ((0, cdn_1.isS3Configured)()) {
            try {
                const stream = await (0, cdn_1.streamFromS3)(key);
                res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFileName)}"`);
                // Streams emit 'error' asynchronously — a mid-transfer failure here
                // would otherwise be an unhandled event that can crash the process.
                stream.on('error', (streamErr) => {
                    logger_1.logger.error(`S3 stream errored mid-transfer for document "${doc.id}"`, streamErr);
                    if (!res.headersSent) {
                        res.status(502).json({ message: 'Failed to stream document' });
                    }
                    else {
                        res.destroy();
                    }
                });
                stream.pipe(res);
                return;
            }
            catch (err) {
                logger_1.logger.warn(`S3 stream failed for document "${doc.id}", trying local: ${String(err)}`);
            }
        }
        const uploadsDir = path_1.default.join(process.cwd(), 'uploads');
        const localPath = path_1.default.join(uploadsDir, key);
        if (!localPath.startsWith(uploadsDir + path_1.default.sep) && localPath !== uploadsDir) {
            return next((0, errorHandler_1.createError)('File not available', 404));
        }
        if (!fs_1.default.existsSync(localPath))
            return next((0, errorHandler_1.createError)('File not found', 404));
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFileName)}"`);
        const readStream = fs_1.default.createReadStream(localPath);
        readStream.on('error', (streamErr) => {
            logger_1.logger.error(`Local file stream errored for document "${doc.id}"`, streamErr);
            if (!res.headersSent) {
                res.status(500).json({ message: 'Failed to read document' });
            }
            else {
                res.destroy();
            }
        });
        readStream.pipe(res);
    }
    catch (err) {
        next(err);
    }
});
// GET /upload/documents — list the caller's documents
router.get('/documents', auth_1.authenticate, async (req, res, next) => {
    try {
        const docs = await prisma_1.prisma.userDocument.findMany({
            where: { userId: req.user.userId },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ documents: docs });
    }
    catch (err) {
        next(err);
    }
});
// DELETE /upload/documents/:id — delete a document
router.delete('/documents/:id', auth_1.authenticate, async (req, res, next) => {
    try {
        const doc = await prisma_1.prisma.userDocument.findUnique({ where: { id: req.params.id } });
        if (!doc) {
            return next((0, errorHandler_1.createError)('Document not found', 404));
        }
        if (doc.userId !== req.user.userId && req.user.role !== 'ADMIN') {
            return next((0, errorHandler_1.createError)('Not authorised', 403));
        }
        await (0, cdn_1.deleteFromCDN)(doc.fileUrl);
        await prisma_1.prisma.userDocument.delete({ where: { id: req.params.id } });
        res.json({ message: 'Document deleted' });
    }
    catch (err) {
        next(err);
    }
});
// GET /upload/documents/user/:userId — list public documents for a user (job market)
router.get('/documents/user/:userId', auth_1.authenticate, async (req, res, next) => {
    try {
        // No public browsing of anyone's documents — owner or admin only.
        if (req.params.userId !== req.user.userId && req.user.role !== 'ADMIN') {
            return next((0, errorHandler_1.createError)('Not authorised', 403));
        }
        const docs = await prisma_1.prisma.userDocument.findMany({
            where: { userId: req.params.userId },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ documents: docs });
    }
    catch (err) {
        next(err);
    }
});
// GET /upload/candidates — admin-only. The public candidate/CV directory on /jobs was removed:
// CVs reach recruiters only through job applications.
router.get('/candidates', auth_1.authenticate, (0, auth_1.authorize)('ADMIN'), async (req, res, next) => {
    try {
        const { page = '1', limit = '20', q = '' } = req.query;
        const pg = Math.max(1, parseInt(page, 10));
        const lim = Math.min(50, Math.max(1, parseInt(limit, 10)));
        const skip = (pg - 1) * lim;
        const whereUser = q.trim()
            ? { name: { contains: q.trim(), mode: 'insensitive' } }
            : {};
        const [total, candidates] = await Promise.all([
            prisma_1.prisma.user.count({
                where: {
                    ...whereUser,
                    documents: { some: { isPublic: true, type: 'CV' } },
                },
            }),
            prisma_1.prisma.user.findMany({
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
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=upload.js.map