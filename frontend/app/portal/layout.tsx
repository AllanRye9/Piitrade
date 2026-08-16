'use client';

import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/dashboard', icon: '📊', label: 'Overview' },
  { href: '/profile/listings', icon: '📦', label: 'My Listings' },
  { href: '/profile/orders', icon: '🛒', label: 'Orders' },
  { href: '/dashboard/store-rental', icon: '🏪', label: 'Store Settings' },
  { href: '/profile', icon: '👤', label: 'Profile' },
  { href: '/profile/subscription', icon: '🔔', label: 'Subscription' },
  { href: '/portal/settings', icon: '⚙️', label: 'Settings' },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login?redirect=' + pathname);
  }, [user, loading, router, pathname]);

  if (loading || !user) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-red-200 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-4">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <aside className="w-full md:w-56 shrink-0">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-4 border-b border-gray-100 bg-gradient-to-r from-red-600 to-rose-600">
              <p className="text-xs font-semibold text-white/70 uppercase tracking-wider">User Portal</p>
              <p className="text-sm font-bold text-white truncate mt-0.5">{user.name}</p>
            </div>
            <nav className="p-2">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href || (pathname?.startsWith(item.href + '/') ?? false);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors mb-0.5 ${
                      isActive
                        ? 'bg-red-50 text-red-700 font-semibold'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
              <div className="mt-2 pt-2 border-t border-gray-100 px-3 py-2.5">
                <a
                  href="mailto:support@piitrade.com"
                  className="flex items-center gap-3 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-base">✉️</span>
                  Email Support
                </a>
              </div>
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
