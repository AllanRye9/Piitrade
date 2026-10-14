'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Listing } from '@/lib/types';
import { ListingGrid } from '@/components/listings/ListingGrid';
import { useRouter } from 'next/navigation';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { T } from '@/components/ui/T';

export default function FavoritesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [listings, setListings] = useState<Listing[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login');
    if (user) {
      api.get('/users/favorites')
        .then(({ data }) => setListings(data))
        .catch(() => {})
        .finally(() => setFetching(false));
    }
  }, [user, loading, router]);

  if (loading || fetching) return <div className="p-8 text-center"><T>Loading...</T></div>;

  return (
    <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Home', href: '/' },
          { label: 'My Profile', href: '/profile' },
          { label: 'Favorites' },
        ]}
      />
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4"><T>My Favorites</T></h1>
      <ListingGrid listings={listings} />
    </div>
  );
}
