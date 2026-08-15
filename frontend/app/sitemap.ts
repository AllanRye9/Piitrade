import type { MetadataRoute } from 'next';
import { apiPath } from '@/lib/apiUrl';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com';

async function fetchSitemapListings(): Promise<{ id: string; updatedAt: string }[]> {
  try {
    const res = await fetch(apiPath('/api/listings?limit=1000&sort=updatedAt'), {
      next: { revalidate: 3600 },
    });
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
    const res = await fetch(apiPath('/api/blog?limit=500'), { next: { revalidate: 3600 } });
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

async function fetchSitemapCategories(): Promise<{ slug: string }[]> {
  try {
    const res = await fetch(apiPath('/api/categories'), { next: { revalidate: 86400 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.categories || data || []).map((c: { slug: string }) => ({ slug: c.slug }));
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
    { url: `${BASE_URL}/stores`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/safety`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/help`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE_URL}/flash-sales`, lastModified: now, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${BASE_URL}/motors`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/property`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/electronics`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/fashion`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/furniture`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
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

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${BASE_URL}/browse/${c.slug}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [...staticRoutes, ...listingRoutes, ...blogRoutes, ...categoryRoutes];
}
