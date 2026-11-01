import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ListingDetailClient from './ListingDetailClient';
import { API_URL } from '@/lib/apiUrl';
import { resolveImageUrl } from '@/lib/utils';
import { jsonLdString, productJsonLd, toSnippet, absoluteUrl } from '@/lib/seo';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com';

type ListingLookup = {
  id: string;
  title?: string;
  description?: string;
  price?: number;
  currency?: string;
  condition?: string;
  status?: string;
  images?: string[];
  location?: string;
  expiresAt?: string | null;
};

type ListingDetailPageProps = {
  params: Promise<{ id: string }>;
};

async function fetchListing(id: string): Promise<ListingLookup | null> {
  try {
    const response = await fetch(`${API_URL}/api/listings/${id}`, {
      next: { revalidate: 300 },
    });

    if (response.status === 404) return null;
    if (!response.ok) return null;

    return (await response.json()) as ListingLookup;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to fetch listing for SEO metadata', { id, message });
    return null;
  }
}

export async function generateMetadata({ params }: ListingDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = await fetchListing(id);

  if (!listing) {
    return {
      title: 'Listing not found | Piitrade Marketplace',
      robots: {
        index: false,
        follow: false,
      },
      alternates: {
        canonical: `${BASE_URL}/listings`,
      },
    };
  }

  return {
    title: listing.title ? `${listing.title} | Piitrade Marketplace` : 'Listing | Piitrade Marketplace',
    description: toSnippet(listing.description, 160) || undefined,
    alternates: {
      canonical: `${BASE_URL}/listings/${id}`,
    },
    // A sold/expired/hidden listing is no use to searchers; keep it out of results (links are still followed).
    robots: {
      index: !listing.status || listing.status === 'ACTIVE',
      follow: true,
    },
    openGraph: {
      type: 'website',
      url: `${BASE_URL}/listings/${id}`,
      title: listing.title || 'Listing',
      description: toSnippet(listing.description, 200) || undefined,
      ...(listing.images?.[0] ? { images: [{ url: absoluteUrl(resolveImageUrl(listing.images[0])) }] } : {}),
    },
    twitter: { card: 'summary_large_image', title: listing.title || 'Listing' },
  };
}

export default async function ListingDetailPage({ params }: ListingDetailPageProps) {
  const { id } = await params;
  const listing = await fetchListing(id);

  if (!listing) {
    notFound();
  }

  const jsonLd = productJsonLd({ ...listing, id }, resolveImageUrl);

  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />}
      <ListingDetailClient />
    </>
  );
}
