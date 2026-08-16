'use client';

import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import ThemeSwitcher from '@/components/ui/ThemeSwitcher';

const SETTINGS_SECTIONS = [
  {
    title: 'Profile & Business Info',
    description: 'Update your name, contact details, company information, and social media links.',
    icon: '👤',
    href: '/profile',
    color: 'border-sky-200 hover:border-sky-400 hover:bg-sky-50',
    iconBg: 'bg-sky-50',
  },
  {
    title: 'My Listings',
    description: 'Create, edit, delete listings. Update status and control placement on the site.',
    icon: '📦',
    href: '/profile/listings',
    color: 'border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50',
    iconBg: 'bg-emerald-50',
  },
  {
    title: 'Store / Digital Space',
    description: 'Manage your rented digital storefront, display preferences, and renewal options.',
    icon: '🏪',
    href: '/dashboard/store-rental',
    color: 'border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50',
    iconBg: 'bg-indigo-50',
  },
  {
    title: 'Subscription & Billing',
    description: 'View your active package, remaining days, and upgrade or renew your plan.',
    icon: '💳',
    href: '/profile/subscription',
    color: 'border-amber-200 hover:border-amber-400 hover:bg-amber-50',
    iconBg: 'bg-amber-50',
  },
  {
    title: 'Orders & Quotes',
    description: 'Track buyer orders, seller sales, and manage quote requests.',
    icon: '🛒',
    href: '/profile/orders',
    color: 'border-violet-200 hover:border-violet-400 hover:bg-violet-50',
    iconBg: 'bg-violet-50',
  },
  {
    title: 'Notifications',
    description: 'View all platform notifications including listing approvals, orders, and account activity.',
    icon: '🔔',
    href: '/notifications',
    color: 'border-rose-200 hover:border-rose-400 hover:bg-rose-50',
    iconBg: 'bg-rose-50',
  },
];

export default function PortalSettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Portal', href: '/portal/settings' },
          { label: 'Settings' },
        ]}
      />

      <div className="bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl p-6 text-white">
        <h1 className="text-2xl font-extrabold">⚙️ Portal Settings</h1>
        <p className="text-white/70 text-sm mt-1">
          Manage all aspects of your digital space from one place, {user?.name?.split(' ')[0]}.
        </p>
      </div>

      {/* Theme */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
          <span>🎨</span> Theme &amp; Appearance
        </h2>
        <div className="flex items-center gap-4">
          <ThemeSwitcher compact />
          <p className="text-sm text-gray-500">Choose your preferred site colour theme.</p>
        </div>
      </div>

      {/* Settings grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className={`group flex items-start gap-4 p-5 bg-white rounded-2xl border transition-all shadow-sm ${section.color}`}
          >
            <div className={`${section.iconBg} w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 group-hover:scale-110 transition-transform`}>
              {section.icon}
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm">{section.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{section.description}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Support */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
          <span>🆘</span> Support
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Need help? Contact our support team directly or browse the help centre.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="mailto:support@3relite.com"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 transition-colors"
          >
            ✉️ Email Support
          </a>
          <Link
            href="/help"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
          >
            📖 Help Centre
          </Link>
        </div>
      </div>
    </div>
  );
}
