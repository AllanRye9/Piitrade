import type { Metadata } from 'next';
import ListingsPageClient from './ListingsPageClient';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://3relite.com';

type ListingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: ListingsPageProps): Promise<Metadata> {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const hasQueryParams = Object.keys(resolvedSearchParams).length > 0;

  return {
    alternates: {
      canonical: `${BASE_URL}/listings`,
    },
    robots: hasQueryParams
      ? {
          index: false,
          follow: true,
        }
      : {
          index: true,
          follow: true,
        },
  };
}

export default function ListingsPage() {
  return <ListingsPageClient />;
}
