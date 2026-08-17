/**
 * Image Serving Route
 *
 * GET /api/images/:filename
 * GET /api/images/:folder/:filename   (for S3 keys with folder prefixes)
 *
 * Serves product images stored in the S3-compatible bucket by proxying the
 * object content through the backend.  When S3 is not configured the handler
 * falls back to serving files from the local `uploads/` directory so that the
 * development experience is unchanged.
 *
 * Using a proxy endpoint keeps the storage bucket private: no public read
 * access needs to be granted on the bucket.  Each request fetches the object
 * directly from S3 and streams it to the HTTP client.
 *
 * S3 keys may include folder prefixes (e.g. "UAE/electronics/uuid.jpg").
 * `uploadToCDN` percent-encodes the full key so slashes become %2F in the
 * stored URL.  The handler decodes the path and passes the full key to S3.
 */

import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { isS3Configured, streamFromS3 } from '../utils/cdn';
import { logger } from '../utils/logger';

const router = Router();

router.get('/*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Decode the path so that %2F-encoded S3 folder separators are expanded.
    // Strip the leading slash that Express keeps in req.path.
    let rawKey: string;
    try {
      rawKey = decodeURIComponent(req.path.replace(/^\//, ''));
    } catch (err) {
      logger.warn(`Failed to decode image path: ${req.path}`, err);
      res.status(400).json({ message: 'Invalid filename' });
      return;
    }

    // Prevent path traversal and absolute paths
    if (!rawKey || rawKey.includes('..') || path.isAbsolute(rawKey)) {
      res.status(400).json({ message: 'Invalid filename' });
      return;
    }

    // User documents (CVs, certificates, ID uploads — some marked private)
    // live under the "documents/" prefix and are never served from this
    // unauthenticated public proxy, regardless of storage backend. They're
    // only reachable through the authenticated GET /api/upload/documents/:id/file
    // route, which checks ownership/visibility before streaming anything.
    if (rawKey === 'documents' || rawKey.startsWith('documents/')) {
      res.status(403).json({ message: 'Not accessible directly' });
      return;
    }

    // Derive extension from the last segment
    const ext = path.extname(rawKey).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      // Video formats — required so admin-uploaded demo videos (e.g. the
      // Interview Prep demo video) can be streamed back through this same
      // proxy endpoint. Without these, any video stored via uploadToCDN
      // returns 400 here and never plays/saves in the UI.
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
    };
    const contentType = contentTypeMap[ext];
    if (!contentType) {
      res.status(400).json({ message: 'Unsupported file format' });
      return;
    }

    // ── S3 proxy ──────────────────────────────────────────────────────────────
    if (isS3Configured()) {
      try {
        const stream = await streamFromS3(rawKey);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24-hour browser cache
        // Streams emit 'error' asynchronously — a mid-transfer failure here
        // would otherwise be an unhandled event that can crash the process.
        stream.on('error', (streamErr) => {
          logger.error(`S3 stream errored mid-transfer for "${rawKey}"`, streamErr);
          if (!res.headersSent) {
            res.status(502).json({ message: 'Failed to stream image' });
          } else {
            res.destroy();
          }
        });
        stream.pipe(res);
        return;
      } catch (err) {
        // If S3 fetch fails, fall through to local fallback
        logger.warn(`S3 stream failed for "${rawKey}", trying local: ${String(err)}`);
      }
    }

    // ── Local file fallback ────────────────────────────────────────────────────
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const localPath = path.join(uploadsDir, rawKey);

    // Prevent path traversal by ensuring the resolved path is inside uploadsDir
    if (!localPath.startsWith(uploadsDir + path.sep) && localPath !== uploadsDir) {
      res.status(400).json({ message: 'Invalid filename' });
      return;
    }

    if (!fs.existsSync(localPath)) {
      res.status(404).json({ message: 'Image not found' });
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const readStream = fs.createReadStream(localPath);
    readStream.on('error', (streamErr) => {
      logger.error(`Local file stream errored for "${localPath}"`, streamErr);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Failed to read image' });
      } else {
        res.destroy();
      }
    });
    readStream.pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
