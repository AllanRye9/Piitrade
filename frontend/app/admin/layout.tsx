'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

const navGroups = [
  {
    label: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard', icon: '📊' },
      { href: '/admin/analytics', label: 'Analytics', icon: '📈' },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/listings', label: 'Listings', icon: '📋' },
      { href: '/admin/bulk-post', label: 'Bulk Post', icon: '📝' },
      { href: '/admin/partners', label: 'Partners & Stores', icon: '🤝' },
      { href: '/admin/categories', label: 'Categories', icon: '🏷️' },
      { href: '/admin/blog', label: 'Blog', icon: '✍️' },
      { href: '/admin/jobs', label: 'Jobs Management', icon: '💼' },
      { href: '/admin/images', label: 'Image Moderation', icon: '🖼️' },
      { href: '/admin/media', label: 'Site Media', icon: '📁' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/submissions', label: 'Submissions', icon: '📥' },
      { href: '/admin/cv-history', label: 'CV History', icon: '📄' },
      { href: '/admin/orders', label: 'Orders', icon: '📦' },
      { href: '/admin/returns', label: 'Returns', icon: '↩️' },
      { href: '/admin/reviews', label: 'Reviews', icon: '⭐' },
      { href: '/admin/reports', label: 'Reports', icon: '🚩' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/coupons', label: 'Coupons', icon: '🎟️' },
      { href: '/admin/withdrawals', label: 'Withdrawals', icon: '💰' },
      { href: '/admin/packages', label: 'Packages', icon: '📦' },
      { href: '/admin/subscriptions', label: 'Subscriptions', icon: '🔔' },
      { href: '/admin/shipping', label: 'Shipping Rates', icon: '🚚' },
      { href: '/admin/currency-rates', label: 'Exchange Rates', icon: '💱' },
    ],
  },
  {
    label: 'Users & Settings',
    items: [
      { href: '/admin/users', label: 'Users', icon: '👥' },
      { href: '/admin/const', label: 'Account Types', icon: '🏷️' },
      { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
    ],
  },
];

// Flat list for active-state checks
const navItems = navGroups.flatMap((g) => g.items);

function isNavActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname.startsWith(href);
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (pathname && pathname.startsWith('/admin/auth')) {
    return <>{children}</>;
  }

  const sidebarWidth = collapsed ? 'md:w-16' : 'md:w-64';
  const mainMargin = collapsed ? 'md:ml-16' : 'md:ml-64';

  return (
    <div className="flex min-h-screen font-sans" style={{ background: '#f1f5f9' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex flex-col text-white
          transition-all duration-300 ease-in-out
          w-64 ${sidebarWidth}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
        style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)' }}
      >
        {/* Sidebar Header */}
        <div
          className="flex h-16 items-center justify-between px-4 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center text-sm font-black shrink-0 shadow-lg">
              3R
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-tight text-white truncate leading-tight">3R Elite</p>
                <p className="text-[10px] font-semibold text-sky-400 tracking-widest uppercase">Admin Portal</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="hidden md:flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                {collapsed ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
                )}
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="md:hidden flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Close sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {collapsed ? (
            // Collapsed: flat icon list
            <ul className="space-y-0.5">
              {navItems.map(({ href, label, icon }) => {
                const active = pathname ? isNavActive(pathname, href) : false;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      title={label}
                      className={`flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-colors duration-150 ${
                        active
                          ? 'bg-sky-500 text-white shadow-sm'
                          : 'text-slate-400 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span className="text-base leading-none">{icon}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            // Expanded: grouped navigation
            <div className="space-y-4">
              {navGroups.map((group) => (
                <div key={group.label}>
                  <p className="px-3 mb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map(({ href, label, icon }) => {
                      const active = pathname ? isNavActive(pathname, href) : false;
                      return (
                        <li key={href}>
                          <Link
                            href={href}
                            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                              active
                                ? 'bg-sky-500 text-white shadow-sm'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <span className="text-base leading-none shrink-0">{icon}</span>
                            <span className="truncate">{label}</span>
                            {active && (
                              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/60 shrink-0" />
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </nav>

        {/* Admin user info + Back to Site */}
        <div className="px-2 py-3 space-y-1 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {user && !collapsed && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-1" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-xs font-bold shrink-0 shadow">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate leading-tight">{user.name}</p>
                <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
              </div>
              <span className="shrink-0 text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded-full">
                ADMIN
              </span>
            </div>
          )}
          {user && collapsed && (
            <div className="flex justify-center py-1 mb-1">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-xs font-bold shadow">
                {user.name.charAt(0).toUpperCase()}
              </div>
            </div>
          )}
          <Link
            href="/"
            title={collapsed ? 'Back to Site' : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-400 transition-colors duration-150 hover:bg-white/10 hover:text-white ${collapsed ? 'justify-center' : ''}`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {!collapsed && <span>Back to Site</span>}
          </Link>
        </div>
      </aside>

      {/* Main content area */}
      <div className={`flex flex-1 flex-col min-h-screen transition-all duration-300 ${mainMargin}`}>
        {/* Mobile topbar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Open sidebar"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-sky-500 flex items-center justify-center text-[10px] font-black text-white">3R</div>
            <span className="text-sm font-bold text-gray-800">Admin Portal</span>
          </div>
        </div>

        {/* Desktop topbar */}
        <div className="hidden md:flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span>Admin</span>
            {pathname && pathname !== '/admin' && (
              <>
                <span className="text-gray-300">/</span>
                <span className="text-gray-800 font-semibold capitalize">
                  {pathname.split('/').filter(Boolean).slice(1).join(' › ')}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold">System Live</span>
            </div>
            <Link
              href="/admin/settings"
              className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-3 py-1 hover:bg-gray-100 transition-colors font-medium"
            >
              ⚙️ Settings
            </Link>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-100 px-4 py-4 sm:px-6 lg:px-8">
          {children}
        </main>

        <footer className="bg-white border-t border-gray-200 px-6 py-3 text-center text-xs text-gray-400 shrink-0">
          3R Elite Admin Portal &copy; {new Date().getFullYear()} — All rights reserved
        </footer>
      </div>
    </div>
  );
}
