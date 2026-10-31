'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import type { SellerPackage } from '@/lib/types';
import { formatAllowance, formatDuration, formatPackagePrice } from '@/lib/subscriptionPlans';

/** Active Merchant packages, straight from the admin (Admin → Packages → Merchant). */
export function useStorePackages() {
  const [packages, setPackages] = useState<SellerPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/packages', { params: { scope: 'STORE' } })
      .then(({ data }) => { if (alive) setPackages(data.packages ?? []); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  // Follow the admin's package changes live (quiet: no spinner, errors ignored).
  const quiet = useCallback(() => {
    api.get('/packages', { params: { scope: 'STORE' } })
      .then(({ data }) => {
        const next: SellerPackage[] = data.packages ?? [];
        setPackages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        setFailed(false);
      })
      .catch(() => { /* keep what is shown */ });
  }, []);
  useAutoRefresh(quiet, 20_000);
  return { packages, loading, failed };
}

const TIER_BADGE: Record<string, string> = { GOLD: '🥇 Gold', PLATINUM: '💎 Platinum', FREE: 'Free tier' };

export function StorePackagePicker({
  packages, loading, failed, selectedId, onSelect, hideFree = false,
}: {
  packages: SellerPackage[];
  loading: boolean;
  failed?: boolean;
  selectedId: string | null;
  onSelect: (pkg: SellerPackage) => void;
  /** Renewals: a free package cannot be renewed. */
  hideFree?: boolean;
}) {
  const shown = hideFree ? packages.filter((p) => !p.isFree) : packages;
  if (loading) return <p className="text-sm text-gray-400">Loading packages…</p>;
  if (failed) return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Could not load Merchant packages. Please refresh.</p>;
  if (shown.length === 0) {
    return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No Merchant packages are available yet. Please check back soon.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Merchant package">
      {shown.map((pkg) => {
        const selected = selectedId === pkg.id;
        return (
          <button
            key={pkg.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(pkg)}
            className={`relative rounded-xl border-2 p-4 text-left transition-all ${selected ? 'border-violet-500 bg-violet-50 shadow-md' : 'border-gray-200 bg-white hover:border-violet-300'}`}
          >
            <span className="mb-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">{TIER_BADGE[pkg.storeTier ?? 'FREE']}</span>
            <p className="text-sm font-bold text-gray-900">{pkg.name}</p>
            <p className="mt-0.5 text-lg font-semibold text-violet-600">{pkg.isFree ? 'Free' : formatPackagePrice(pkg.price, String(pkg.currency))}</p>
            {pkg.description && <p className="mt-1 text-xs text-gray-500">{pkg.description}</p>}
            <p className="mt-1 text-xs text-gray-400">Duration: {formatDuration(pkg.durationDays)}</p>
            <p className="text-xs text-gray-400">{formatAllowance(pkg.maxListings, 'STORE')}</p>
          </button>
        );
      })}
    </div>
  );
}
