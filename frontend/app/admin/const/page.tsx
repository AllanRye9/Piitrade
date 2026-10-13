'use client';

/**
 * "Account Types" duplicated the role editor in Admin → Users. Kept as a
 * redirect so old bookmarks keep working.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminConstRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/users'); }, [router]);
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
