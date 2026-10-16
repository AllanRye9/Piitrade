import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';
import { isS3Configured, streamFromS3 } from './cdn';
import { logger } from './logger';

/**
 * Visual fingerprinting for search-by-photo.
 *
 * Two cheap, dependency-free signals (sharp is already installed):
 *   - dHash: 64-bit difference hash of a 9x8 greyscale thumbnail. Robust to
 *     resizing / recompression / small crops, so it finds the same item or
 *     near-duplicate photos of it.
 *   - colour signature: a 4x4 RGB grid (48 values). Coarse, but separates a
 *     red car from a white sofa when the hash alone is ambiguous.
 *
 * Fingerprints of listing photos are computed lazily and kept in a bounded
 * in-memory cache, so the first photo search warms the index and later ones
 * are fast. Nothing is written to the database.
 */

export interface Fingerprint {
  hash: bigint;
  color: number[];
}

const MAX_CACHE = 4000;
const cache = new Map<string, Fingerprint | null>();

function remember(url: string, fp: Fingerprint | null) {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(url, fp);
}

export async function fingerprintBuffer(buf: Buffer): Promise<Fingerprint> {
  const base = sharp(buf, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' });
  const [grey, rgb] = await Promise.all([
    base.clone().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer(),
    base.clone().removeAlpha().resize(4, 4, { fit: 'fill' }).raw().toBuffer(),
  ]);
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (grey[y * 9 + x] > grey[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return { hash, color: Array.from(rgb) };
}

function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

function colorDistance(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / (n * 255); // 0 = identical, 1 = opposite
}

/** Similarity 0..1 combining shape (dHash) and colour. */
export function similarity(a: Fingerprint, b: Fingerprint): { score: number; distance: number } {
  const distance = hamming(a.hash, b.hash);
  const score = 0.7 * (1 - distance / 64) + 0.3 * (1 - colorDistance(a.color, b.color));
  return { score, distance };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

/**
 * Reads a stored listing photo. Only our own storage is read (S3 proxy keys
 * and the local uploads dir) — never arbitrary seller-supplied URLs.
 */
async function readStoredImage(url: string): Promise<Buffer | null> {
  try {
    let rel = url;
    if (/^https?:\/\//i.test(rel)) {
      const u = new URL(rel);
      rel = u.pathname;
    }
    if (rel.startsWith('/api/images/')) {
      const key = decodeURIComponent(rel.replace('/api/images/', ''));
      if (key.includes('..')) return null;
      if (isS3Configured()) return await streamToBuffer(await streamFromS3(key));
      rel = `/uploads/${key}`;
    }
    if (rel.startsWith('/uploads/')) {
      const uploadsRoot = path.resolve(process.cwd(), 'uploads');
      const file = path.resolve(uploadsRoot, rel.replace('/uploads/', ''));
      if (!file.startsWith(uploadsRoot + path.sep)) return null;
      return await fs.promises.readFile(file);
    }
    return null;
  } catch {
    return null;
  }
}

async function fingerprintStored(url: string): Promise<Fingerprint | null> {
  if (cache.has(url)) return cache.get(url) ?? null;
  const buf = await readStoredImage(url);
  if (!buf) { remember(url, null); return null; }
  try {
    const fp = await fingerprintBuffer(buf);
    remember(url, fp);
    return fp;
  } catch {
    remember(url, null);
    return null;
  }
}

export interface VisualMatch {
  id: string;
  title: string;
  price: number;
  currency: string;
  location: string | null;
  image: string;
  score: number;
}

/**
 * Ranks recent active listings by visual similarity to `query`. Works within a
 * time budget: whatever candidate photos were fingerprinted in time are used,
 * the rest are picked up by the next search (cache warms up).
 */
export async function findVisualMatches(query: Fingerprint, opts: { limit?: number; budgetMs?: number } = {}): Promise<VisualMatch[]> {
  const { limit = 8, budgetMs = 4500 } = opts;
  const now = new Date();
  const rows = await prisma.listing.findMany({
    where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: {
      id: true, title: true, price: true, currency: true, location: true, images: true,
      productImages: { where: { cdnUrl: { not: null }, status: { not: 'REJECTED' } }, select: { cdnUrl: true }, orderBy: { uploadedAt: 'asc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
    take: 400,
  });

  const items = rows
    .map((l) => ({ l, image: l.productImages?.[0]?.cdnUrl || l.images?.[0] || '' }))
    .filter((x) => x.image);

  const deadline = Date.now() + budgetMs;
  const scored: { l: (typeof items)[number]['l']; image: string; score: number; distance: number }[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length && Date.now() < deadline) {
      const item = items[cursor++];
      const fp = await fingerprintStored(item.image);
      if (!fp) continue;
      const { score, distance } = similarity(query, fp);
      scored.push({ ...item, score, distance });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  return scored
    .filter((s) => s.distance <= 22 || s.score >= 0.82)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({
      id: s.l.id, title: s.l.title, price: s.l.price, currency: String(s.l.currency),
      location: s.l.location, image: s.image, score: Math.round(s.score * 100) / 100,
    }));
}

let warming = false;
/** Fire-and-forget: pre-computes fingerprints for the newest listings. */
export function warmFingerprintCache(): void {
  if (warming) return;
  warming = true;
  findVisualMatches({ hash: 0n, color: new Array(48).fill(0) }, { budgetMs: 20000, limit: 1 })
    .catch((e) => logger.warn(`fingerprint warm-up failed: ${String(e)}`))
    .finally(() => { warming = false; });
}
