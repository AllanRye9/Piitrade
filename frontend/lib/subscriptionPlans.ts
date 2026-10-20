/**
 * Plan presentation + upgrade rules, derived ONLY from package data.
 * Nothing here knows what a "trial", "monthly" or "annual" plan is: a plan is just a duration, a
 * price and a listing allowance an admin chose, so changing a package in Admin → Packages changes
 * what every page shows.
 */
import type { PackageScope, SellerPackage, SubscriptionTerms } from '@/lib/types';

export function formatDuration(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '—';
  if (days >= 360 && days <= 370) return '1 year';
  if (days > 370 && days % 365 === 0) return `${days / 365} years`;
  if (days >= 30 && days % 30 === 0 && days < 360) return days === 30 ? '1 month' : `${days / 30} months`;
  return days === 1 ? '1 day' : `${days} days`;
}

/** Badge text for a package card — straight from its duration. */
export function planLabel(pkg: Pick<SellerPackage, 'durationDays' | 'isFree'>): string {
  return pkg.isFree ? `${formatDuration(pkg.durationDays)} free` : formatDuration(pkg.durationDays);
}

export function formatAllowance(maxListings: number | null | undefined, scope: PackageScope): string {
  if (scope === 'CV') return maxListings != null ? `${maxListings} CV tools` : 'All CV tools';
  return maxListings != null ? `${maxListings} listing${maxListings === 1 ? '' : 's'}` : 'Unlimited listings';
}

/**
 * Money exactly as the package defines it. Amounts entered in a foreign currency are converted with
 * the admin-managed rate (`convert`, from usePricingCurrency) — never a literal exchange rate.
 */
export function formatPackagePrice(
  price: number,
  currency: string,
  convert?: (usd: number) => number,
): string {
  if (!(price > 0)) return 'Free';
  const inUgx = currency === 'USD' && convert ? convert(price) : price;
  const code = currency === 'USD' && convert ? 'UGX' : currency;
  return `${code} ${Math.round(inUgx).toLocaleString('en-US')}`;
}

type Rankable = Pick<SubscriptionTerms, 'durationDays' | 'maxListings' | 'price'>;
const capRank = (n: number | null | undefined) => (n == null ? Number.POSITIVE_INFINITY : n);

/** Same rule as the API (utils/subscriptionService.ts isUpgrade) so the UI only offers what the API accepts. */
export function isUpgrade(current: Rankable, target: Rankable & { isFree?: boolean }): boolean {
  if (target.isFree) return false;
  if (target.durationDays > current.durationDays) return true;
  if (target.durationDays < current.durationDays) return false;
  return capRank(target.maxListings) > capRank(current.maxListings) || target.price > current.price;
}
