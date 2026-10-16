/**
 * uploadGuard.ts — content-based validation for files about to be stored.
 *
 * Multer's fileFilter only sees the CLIENT-supplied mimetype and original
 * filename, both of which an attacker controls. Without this check a file such
 * as `evil.html` (declared as image/png) was stored under its own extension, and
 * on the local-disk fallback `express.static('/uploads')` then served it as
 * text/html — stored XSS on the API origin.
 *
 * This module decides from the file's actual leading bytes ("magic numbers")
 * whether the content matches the extension it will be stored under, and
 * rejects every extension that is not on the allow-list.
 */
import fs from 'fs';
import path from 'path';

export type FileKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'pdf' | 'zip' | 'ole' | 'mp4' | 'webm' | 'avi';

/** Extension -> the content kind that extension is allowed to contain. */
const EXTENSION_KIND: Record<string, FileKind> = {
  '.jpg': 'jpeg', '.jpeg': 'jpeg', '.jfif': 'jpeg', '.jpe': 'jpeg', '.pjpeg': 'jpeg', '.pjp': 'jpeg',
  '.png': 'png',
  '.gif': 'gif',
  '.webp': 'webp',
  '.pdf': 'pdf',
  '.docx': 'zip',
  '.doc': 'ole',
  '.mp4': 'mp4', '.mov': 'mp4',
  '.webm': 'webm',
  '.avi': 'avi',
};

const MIME_DEFAULT_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'application/pdf': '.pdf', 'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-msvideo': '.avi',
};

/**
 * The extension a freshly uploaded file will be stored under. A recognised
 * client-supplied extension is kept (e.g. Windows' ".jfif"); anything else —
 * ".html", ".svg", ".php", no extension at all — is replaced by the one implied
 * by the declared mimetype, or ".bin" (which {@link checkUploadContent} rejects).
 */
export function safeExtension(originalName: string, mimetype: string): string {
  const ext = path.extname(originalName || '').toLowerCase();
  if (EXTENSION_KIND[ext]) return ext;
  return MIME_DEFAULT_EXTENSION[(mimetype || '').toLowerCase()] ?? '.bin';
}

/** Identify a file from its first bytes. Returns null when nothing matches. */
export function sniffFileKind(head: Buffer): FileKind | null {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const ascii = (start: number, text: string) => head.subarray(start, start + text.length).toString('latin1') === text;

  if (head.length < 4) return null;
  if (startsWith(0xff, 0xd8, 0xff)) return 'jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';
  if (ascii(0, 'RIFF') && ascii(8, 'AVI ')) return 'avi';
  if (ascii(0, '%PDF-')) return 'pdf';
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return 'zip';
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'ole';
  if (ascii(4, 'ftyp')) return 'mp4';
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return 'webm';
  return null;
}

export type UploadCheck = { ok: true } | { ok: false; reason: string };

/** Pure check used by tests and by {@link assertSafeUploadFile}. */
export function checkUploadContent(filename: string, head: Buffer): UploadCheck {
  const ext = path.extname(filename).toLowerCase();
  const expected = EXTENSION_KIND[ext];
  if (!expected) return { ok: false, reason: `File type "${ext || '(none)'}" is not allowed` };
  const actual = sniffFileKind(head);
  if (actual !== expected) return { ok: false, reason: 'File content does not match its file type' };
  return { ok: true };
}

/** Reads the first bytes of `filePath` and throws if they don't match `filename`'s extension. */
export function assertSafeUploadFile(filePath: string, filename: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, 16, 0);
    const result = checkUploadContent(filename, head.subarray(0, read));
    if (result.ok === false) {
      const err = new Error(result.reason) as Error & { statusCode?: number; isOperational?: boolean };
      err.statusCode = 400;
      err.isOperational = true;
      throw err;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Storage prefixes that must never be reachable through the public file proxy / static mount. */
// NOTE: temp/ and search-temp/ are intentionally NOT listed: the photo-search AI
// worker fetches search-temp/ files without credentials, and listings.ts falls
// back to /uploads/temp/<file> for images still awaiting moderation.
export const PRIVATE_STORAGE_PREFIXES = ['documents', 'kyc'] as const;

export function isPrivateStorageKey(key: string): boolean {
  const first = key.replace(/^\/+/, '').split('/')[0].toLowerCase();
  return (PRIVATE_STORAGE_PREFIXES as readonly string[]).includes(first);
}
