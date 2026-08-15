import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ListingDetailClient from './ListingDetailClient';
import { apiPath } from '@/lib/apiUrl';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://piitrade.com';

type ListingLookup = {
  id: string;
  title?: string;
  description?: string;
};

type ListingDetailPageProps = {
  params: Promise<{ id: string }>;
};

async function fetchListing(id: string): Promise<ListingLookup | null> {
  try {
    const response = await fetch(apiPath(`/api/listings/${id}`), {
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
    description: listing.description,
    alternates: {
      canonical: `${BASE_URL}/listings/${id}`,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function ListingDetailPage({ params }: ListingDetailPageProps) {
  const { id } = await params;
  const listing = await fetchListing(id);

  if (!listing) {
    notFound();
  }

  return <ListingDetailClient />;
}
