'use client';

/**
 * /admin/store-rentals moved to /admin/webstores (Partners and Merchants are now separate
 * pages). This page just redirects so old bookmarks/links keep working.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminStoreRentalsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/webstores');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
