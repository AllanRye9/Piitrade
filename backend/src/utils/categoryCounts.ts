/**
 * categoryCounts.ts — live item counts per category for the navigation and category highlights.
 *
 * One computation backs every counts endpoint, so numbers can never disagree between the home
 * page, the nav and a category page. It uses EXACTLY the predicate the public listing queries use
 * (status ACTIVE, and not past `expiresAt` even if the expiry sweep hasn't flipped it yet), so a
 * count is always the number of listings a visitor would actually see.
 *
 * Freshness: the cache is dropped the instant a listing is created / approved / rejected / sold /
 * removed / expired (invalidateCategoryCounts(), called from those code paths), so on one instance
 * the figures are real-time. A short TTL covers other instances and any writer that forgot to
 * invalidate; at worst a count lags by CACHE_TTL_MS. Concurrent requests share one query.
 */
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from './prisma';

export const CACHE_TTL_MS = 5_000;

export interface CategoryCountsResult {
  /** slug -> live listings in that category PLUS all descendants (jobs = open JobPost rows). */
  counts: Record<string, number>;
  /** slug -> live listings filed DIRECTLY in that category (used to hide empty subcategories). */
  direct: Record<string, number>;
  /** slug -> listings (incl. descendants) created in the last 24 hours, for "new" highlights. */
  new24h: Record<string, number>;
  total: number;
  country: string | null;
  generatedAt: string;
  /** Stable content hash — use as the ETag. Changes only when a number changes. */
  etag: string;
}

export interface CategoryRow { id: string; slug: string; parentId: string | null }
export interface GroupRow { categoryId: string; direct: number; recent: number }

/** Pure: roll direct counts up the category tree. Guards against parent cycles. */
export function rollUp(
  rows: GroupRow[],
  categories: CategoryRow[],
  openJobs: number,
): { counts: Record<string, number>; direct: Record<string, number>; new24h: Record<string, number>; total: number } {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const counts: Record<string, number> = {};
  const direct: Record<string, number> = {};
  const new24h: Record<string, number> = {};
  let total = 0;

  for (const r of rows) {
    const cat = byId.get(r.categoryId);
    if (!cat) continue;
    total += r.direct;
    direct[cat.slug] = (direct[cat.slug] ?? 0) + r.direct;
    const seen = new Set<string>();
    let cur: CategoryRow | undefined = cat;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      counts[cur.slug] = (counts[cur.slug] ?? 0) + r.direct;
      if (r.recent > 0) new24h[cur.slug] = (new24h[cur.slug] ?? 0) + r.recent;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  // The Jobs page is backed by JobPost, not by listings filed under the category.
  if (openJobs > 0) counts.jobs = openJobs; else delete counts.jobs;
  return { counts, direct, new24h, total };
}

const cache = new Map<string, { at: number; value: CategoryCountsResult }>();
const inflight = new Map<string, Promise<CategoryCountsResult>>();
let generation = 0;

/** Call whenever a listing's visibility or category could have changed. Cheap and synchronous. */
export function invalidateCategoryCounts(): void {
  generation++;
  cache.clear();
}

async function compute(country: string | null): Promise<CategoryCountsResult> {
  const countryFilter = country ? Prisma.sql`AND l."country" = ${country}::"Country"` : Prisma.empty;
  const jobCountry = country ? { country: country as 'UGANDA' } : {};
  const [rows, categories, openJobs] = await Promise.all([
    prisma.$queryRaw<GroupRow[]>(Prisma.sql`
      SELECT l."categoryId" AS "categoryId",
             COUNT(*)::int AS "direct",
             COUNT(*) FILTER (WHERE l."createdAt" > NOW() - INTERVAL '24 hours')::int AS "recent"
      FROM "Listing" l
      WHERE l."status" = 'ACTIVE'
        AND (l."expiresAt" IS NULL OR l."expiresAt" > NOW())
        ${countryFilter}
      GROUP BY l."categoryId"`),
    prisma.category.findMany({ select: { id: true, slug: true, parentId: true } }),
    prisma.jobPost.count({ where: { status: 'ACTIVE', ...jobCountry } }),
  ]);
  const { counts, direct, new24h, total } = rollUp(rows, categories, openJobs);
  const body = { counts, direct, new24h, total, country };
  const etag = '"' + createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16) + '"';
  return { ...body, generatedAt: new Date().toISOString(), etag };
}

export async function getCategoryCounts(country: string | null = null): Promise<CategoryCountsResult> {
  const key = country ?? '__all__';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const running = inflight.get(key);
  if (running) return running; // share one query between simultaneous requests

  const startedAt = generation;
  const p = compute(country)
    .then((value) => {
      // If a listing changed while we were querying, don't cache a possibly-stale snapshot.
      if (startedAt === generation) cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}
