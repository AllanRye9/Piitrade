import { assertSafeUploadFile } from './uploadGuard';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger';



// ─── S3-compatible storage ─────────────────────────────────────────────────────

/**
 * Returns a configured S3 client when all required environment variables are
 * present, or null when S3 is not configured.  Supports both AWS S3 and any
 * S3-compatible provider (Railway bucket, MinIO, etc.) via the optional
 * ENDPOINT variable.
 */
function getS3Client(): S3Client | null {
  const accessKeyId = process.env.ACCESS_KEY_ID;
  const secretAccessKey = process.env.SECRET_ACCESS_KEY;
  const region = 'auto';
  const bucket = process.env.BUCKET;

  if (!accessKeyId || !secretAccessKey || !bucket) return null;

  const endpoint = process.env.ENDPOINT;
  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

/**
 * Uploads a file to the S3-compatible bucket and returns the object key.
 * Throws on error so callers can fall back to other providers.
 *
 * @param tempFilePath - Absolute path to the local temp file.
 * @param filename     - Base filename (UUID + extension).
 * @param folder       - Optional path prefix for category/country organisation
 *                       (e.g. "UAE/electronics"). Defaults to flat storage.
 */
async function uploadToS3(tempFilePath: string, filename: string, folder?: string): Promise<string> {
  const client = getS3Client();
  const bucket = process.env.BUCKET!;
  if (!client) throw new Error('S3 not configured');

  const ext = path.extname(filename).toLowerCase();
  const contentTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    // Video formats (e.g. the Interview Prep admin-uploaded demo video).
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
  };
  const contentType = contentTypeMap[ext] || 'application/octet-stream';

  // Build the S3 object key, optionally prefixed by folder for organisation.
  const key = folder ? `${folder}/${filename}` : filename;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(tempFilePath),
      ContentType: contentType,
      ContentLength: fs.statSync(tempFilePath).size,
    }),
  );

  return key; // return the object key (may include folder prefix)
}

/**
 * Generates a pre-signed URL for the given S3 object key.
 * Defaults to 3600 seconds (1 hour) expiry.
 *
 * @param key         - S3 object key (filename stored in DB cdnUrl).
 * @param expiresIn   - Validity period in seconds.
 */
export async function getS3SignedUrl(key: string, expiresIn = 3600): Promise<string | null> {
  const client = getS3Client();
  const bucket = process.env.BUCKET;
  if (!client || !bucket) return null;

  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return await getSignedUrl(client, command, { expiresIn });
  } catch (err) {
    logger.warn(`S3 signed URL generation failed for key "${key}": ${String(err)}`);
    return null;
  }
}

/**
 * Returns a Node.js Readable stream for an object stored in S3.  Used by the
 * image proxy endpoint to stream content to the HTTP client.
 *
 * @param key - S3 object key.
 */
export async function streamFromS3(key: string): Promise<Readable> {
  const client = getS3Client();
  const bucket = process.env.BUCKET;
  if (!client || !bucket) throw new Error('S3 not configured');

  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error('Empty S3 response body');
  return response.Body as Readable;
}

/**
 * Deletes an object from the S3-compatible bucket.  Best-effort: errors are
 * logged but not re-thrown so callers are not blocked.
 *
 * @param key - S3 object key to delete.
 */
export async function deleteFromS3(key: string): Promise<void> {
  const client = getS3Client();
  const bucket = process.env.BUCKET;
  if (!client || !bucket) return;

  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    logger.warn(`S3 delete failed for key "${key}": ${String(err)}`);
  }
}

/**
 * Deletes a previously uploaded asset URL from whichever backing store is in use.
 * Supports:
 *   - /api/images/{encodedKey}  -> private S3 key (proxy URL)
 *   - /uploads/{path}           -> local filesystem fallback
 *   - absolute URLs containing either of the above path shapes
 */
export async function deleteFromCDN(fileUrl: string): Promise<void> {
  if (!fileUrl) return;

  try {
    const normalizedPath = (() => {
      try {
        if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
          return new URL(fileUrl).pathname;
        }
      } catch {
        // Fall through and treat as relative path.
      }
      return fileUrl;
    })();

    const imageProxyMarker = '/api/images/';
    const uploadsMarker = '/uploads/';

    const imageProxyIndex = normalizedPath.indexOf(imageProxyMarker);
    if (imageProxyIndex >= 0) {
      const encodedKey = normalizedPath.slice(imageProxyIndex + imageProxyMarker.length);
      if (encodedKey) {
        const key = decodeURIComponent(encodedKey);
        await deleteFromS3(key);
      }
      return;
    }

    const uploadsIndex = normalizedPath.indexOf(uploadsMarker);
    if (uploadsIndex >= 0) {
      const relativePath = normalizedPath.slice(uploadsIndex + uploadsMarker.length);
      if (!relativePath || relativePath.includes('..') || path.isAbsolute(relativePath)) return;

      const uploadsRoot = path.join(process.cwd(), 'uploads');
      const localPath = path.join(uploadsRoot, relativePath);
      if (!localPath.startsWith(uploadsRoot + path.sep) && localPath !== uploadsRoot) return;

      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
    }
  } catch (err) {
    logger.warn(`Failed to delete CDN asset "${fileUrl}": ${String(err)}`);
  }
}

/**
 * Returns true when all required S3 environment variables are present.
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.ACCESS_KEY_ID &&
    process.env.SECRET_ACCESS_KEY &&
    process.env.BUCKET
  );
}

// ─── CDN upload orchestrator ───────────────────────────────────────────────────

/**
 * Uploads an image file to the best available storage provider and returns a
 * URL that can be persisted in the database and used as an <img> src.
 *
 * Priority order:
 *   1. S3-compatible bucket (Railway bucket / AWS S3 / MinIO) – images are
 *      served through the /api/images proxy so the bucket can remain private.
 *   2. Local filesystem fallback (development / Docker Compose)
 *
 * IMPORTANT: URLs stored in the database are always relative paths
 * (e.g. `/api/images/…` or `/uploads/…`).  The frontend's `resolveImageUrl`
 * utility prepends `NEXT_PUBLIC_API_URL` at render time, so the same DB value
 * works correctly in every environment without re-saving.
 *
 * @param tempFilePath - Absolute path to the temporary image file.
 * @param filename     - Final filename to use for the public asset.
 * @param folder       - Optional folder prefix for category/country organisation
 *                       (e.g. "UAE/electronics").  When provided the S3 key
 *                       becomes "{folder}/{filename}" so images are grouped by
 *                       country and category in the bucket.
 */
export async function uploadToCDN(tempFilePath: string, filename: string, folder?: string): Promise<string> {
  // Refuse anything whose real bytes don't match an allow-listed type/extension
  // (multer only checked the client-declared mimetype). Throws a 400.
  assertSafeUploadFile(tempFilePath, filename);

  // ── 1. S3-compatible bucket (Railway bucket) ─────────────────────────────────
  if (isS3Configured()) {
    try {
      const key = await uploadToS3(tempFilePath, filename, folder);
      // Store as a relative path — resolveImageUrl() on the frontend will
      // prepend NEXT_PUBLIC_API_URL so the URL is correct in every environment.
      return `/api/images/${encodeURIComponent(key)}`;
    } catch (err) {
      logger.warn(`S3 upload failed, falling back: ${String(err)}`);
    }
  }

  // ── 2. Local filesystem ───────────────────────────────────────────────────────
  return uploadToLocal(tempFilePath, filename, folder);
}

async function uploadToLocal(tempFilePath: string, filename: string, folder?: string): Promise<string> {
  const publicDir = path.join(process.cwd(), 'uploads', ...(folder ? folder.split('/') : []));
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const destPath = path.join(publicDir, filename);
  fs.copyFileSync(tempFilePath, destPath);

  // Store as a relative path — resolveImageUrl() prepends the backend base URL.
  const urlPath = folder ? `${folder}/${filename}` : filename;
  return `/uploads/${urlPath}`;
}
