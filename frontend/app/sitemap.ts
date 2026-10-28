import type { MetadataRoute } from 'next';
import { API_URL } from '@/lib/apiUrl';
import { categoryHref } from '@/lib/categoryLinks';
import { UNGATED_TREES } from '@/lib/categoryVisibility';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com';
const REQUEST_TIMEOUT_MS = 5000;

async function fetchSitemapData(path: string, revalidate: number): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    next: { revalidate },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function fetchSitemapListings(): Promise<{ id: string; updatedAt: string }[]> {
  try {
    const res = await fetchSitemapData('/api/listings?limit=1000&sort=updatedAt', 3600);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.listings || []).map((l: { id: string; updatedAt: string }) => ({
      id: l.id,
      updatedAt: l.updatedAt,
    }));
  } catch {
    return [];
  }
}

async function fetchSitemapBlogPosts(): Promise<{ slug: string; updatedAt: string }[]> {
  try {
    const res = await fetchSitemapData('/api/blog?limit=500', 3600);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.posts || []).map((p: { slug: string; updatedAt: string }) => ({
      slug: p.slug,
      updatedAt: p.updatedAt,
    }));
  } catch {
    return [];
  }
}

// Live listing counts per category slug (rolled up). `null` when they can't be fetched.
async function fetchSitemapCategoryCounts(): Promise<Record<string, number> | null> {
  try {
    const res = await fetchSitemapData('/api/categories/rollup-counts?country=UGANDA', 3600);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.counts && typeof data.counts === 'object' ? (data.counts as Record<string, number>) : null;
  } catch {
    return null;
  }
}

// Top-level categories worth indexing: only ones with live listings (empty categories are thin
// content), linked to a page that actually exists (dedicated storefront or /listings?category=).
// If the counts can't be fetched, none are emitted rather than risk listing ~20 empty categories.
async function fetchSitemapCategories(): Promise<{ slug: string; href: string }[]> {
  try {
    const [res, counts] = await Promise.all([fetchSitemapData('/api/categories', 86400), fetchSitemapCategoryCounts()]);
    if (!res.ok || !counts) return [];
    const data = await res.json();
    const parents = (data.categories || data || []) as { slug: string }[];
    return parents
      .filter((c) => UNGATED_TREES.has(c.slug) || (counts[c.slug] ?? 0) > 0)
      .map((c) => ({ slug: c.slug, href: categoryHref(c.slug) }));
  } catch {
    return [];
  }
}

function parseSitemapDate(value: string | undefined, fallback: Date) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static pages
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE_URL}/listings`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${BASE_URL}/categories`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/stores`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/safety`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/help`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE_URL}/back-to-school`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE_URL}/motors`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/property`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/electronics`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/fashion`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/furniture`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/garden`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/jobs`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
  ];

  const [listings, blogPosts, categories] = await Promise.all([
    fetchSitemapListings(),
    fetchSitemapBlogPosts(),
    fetchSitemapCategories(),
  ]);

  const listingRoutes: MetadataRoute.Sitemap = listings.map((l) => ({
    url: `${BASE_URL}/listings/${l.id}`,
    lastModified: parseSitemapDate(l.updatedAt, now),
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  const blogRoutes: MetadataRoute.Sitemap = blogPosts.map((p) => ({
    url: `${BASE_URL}/blog/${p.slug}`,
    lastModified: parseSitemapDate(p.updatedAt, now),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  // De-duplicate against the static routes above (e.g. /motors is already listed there).
  const staticUrls = new Set(staticRoutes.map((r) => r.url));
  const categoryRoutes: MetadataRoute.Sitemap = categories
    .map((c) => ({ url: `${BASE_URL}${c.href}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 }))
    .filter((r) => !staticUrls.has(r.url));

  return [...staticRoutes, ...listingRoutes, ...blogRoutes, ...categoryRoutes];
}
