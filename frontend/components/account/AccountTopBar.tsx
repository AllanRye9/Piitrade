'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTr } from '@/lib/i18n/useTr';

// Compact, full-width navigation strip shared by /profile/* and /dashboard/*.
// Tabs on the left, a "Settings" dropdown pinned to the right.
const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/profile', label: 'My Profile', match: (p) => p === '/profile' },
  { href: '/profile/listings', label: 'My Listings', match: (p) => p.startsWith('/profile/listings') },
  { href: '/profile/favorites', label: 'Favorites', match: (p) => p.startsWith('/profile/favorites') },
  { href: '/dashboard/store-rental', label: 'Web Store', match: (p) => p === '/dashboard/store-rental' },
  { href: '/dashboard/store-rental/tools', label: 'Store Tools', match: (p) => p.startsWith('/dashboard/store-rental/tools') },
];

const SETTINGS: { href: string; label: string; icon: string }[] = [
  { href: '/profile', label: 'Edit profile', icon: '👤' },
  { href: '/profile/verification', label: 'Identity verification (KYC)', icon: '🪪' },
  { href: '/profile/subscription', label: 'Listing subscription', icon: '📦' },
  { href: '/profile/cv-subscription', label: 'CV subscription', icon: '📄' },
  { href: '/notifications', label: 'Notifications', icon: '🔔' },
  { href: '/help', label: 'Help & support', icon: '❓' },
];

export default function AccountTopBar() {
  const pathname = usePathname() || '';
  const { user, logout } = useAuth();
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!user) return null;

  return (
    <div className="sticky top-[var(--sticky-offset,0px)] z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="flex w-full items-center gap-2 px-2 sm:px-3">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Account">
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active ? 'bg-red-50 text-red-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {tr(t.label)}
              </Link>
            );
          })}
        </nav>

        <div ref={ref} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              open ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.3 4.3a1.7 1.7 0 013.4 0l.2.9a1.7 1.7 0 002.5 1.1l.8-.5a1.7 1.7 0 012.4 2.4l-.5.8a1.7 1.7 0 001.1 2.5l.9.2a1.7 1.7 0 010 3.4l-.9.2a1.7 1.7 0 00-1.1 2.5l.5.8a1.7 1.7 0 01-2.4 2.4l-.8-.5a1.7 1.7 0 00-2.5 1.1l-.2.9a1.7 1.7 0 01-3.4 0l-.2-.9a1.7 1.7 0 00-2.5-1.1l-.8.5a1.7 1.7 0 01-2.4-2.4l.5-.8a1.7 1.7 0 00-1.1-2.5l-.9-.2a1.7 1.7 0 010-3.4l.9-.2a1.7 1.7 0 001.1-2.5l-.5-.8a1.7 1.7 0 012.4-2.4l.8.5a1.7 1.7 0 002.5-1.1l.2-.9z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>{tr('Settings')}</span>
            <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {open && (
            <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
              <div className="border-b border-gray-100 px-3 py-2">
                <p className="truncate text-sm font-bold text-gray-900">{user.name || user.email}</p>
                <p className="truncate text-xs text-gray-500">{user.email}</p>
              </div>
              {SETTINGS.map((s) => (
                <Link key={s.href} href={s.href} role="menuitem" className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50">
                  <span aria-hidden="true" className="w-5 text-center">{s.icon}</span>
                  {tr(s.label)}
                </Link>
              ))}
              <div className="my-1 border-t border-gray-100" />
              <button
                type="button"
                role="menuitem"
                onClick={() => logout()}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
              >
                <span aria-hidden="true" className="w-5 text-center">↪</span>
                {tr('Sign out')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
