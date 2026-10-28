import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CategoryPageClient, { type CategoryPageData } from '@/components/categories/CategoryPageClient';
import { API_URL } from '@/lib/apiUrl';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com';

type PageProps = { params: Promise<{ slug: string }> };

async function fetchCategory(slug: string): Promise<CategoryPageData | null> {
  try {
    const res = await fetch(`${API_URL}/api/categories/by-slug/${encodeURIComponent(slug)}`, { next: { revalidate: 120 } });
    if (!res.ok) return null;
    return (await res.json()) as CategoryPageData;
  } catch {
    return null;
  }
}

// Live listing count for the SEO decision below. null = unknown (then we do not block indexing).
async function fetchCount(slug: string): Promise<number | null> {
  try {
    const res = await fetch(`${API_URL}/api/categories/rollup-counts?country=UGANDA`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = await res.json();
    const n = data?.counts?.[slug];
    return typeof n === 'number' ? n : 0;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchCategory(slug);
  if (!data) {
    return { title: 'Category not found | Piitrade Marketplace', robots: { index: false, follow: false } };
  }
  const count = await fetchCount(slug);
  const name = data.category.name;
  const where = data.parent ? ` in ${data.parent.name}` : '';
  const title = `${name}${where} – buy & sell in Uganda | Piitrade`;
  const description = `Browse ${name}${where} on Piitrade Uganda: new and used listings from sellers near you.`;
  return {
    title,
    description,
    // A category with no listings yet is thin content: keep it out of search results until it has some.
    robots: count === 0 ? { index: false, follow: true } : undefined,
    alternates: { canonical: `${BASE_URL}/category/${slug}` },
    openGraph: { title, description },
  };
}

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await fetchCategory(slug);
  if (!data) notFound();
  return <CategoryPageClient data={data} />;
}
