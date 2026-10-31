/**
 * CV Package resolution & rule enforcement
 * ─────────────────────────────────────────────────────────────────────────
 * The CV builder (cv-generator/builder) does not let sellers subscribe —
 * instead, at any given moment there is at most ONE active CV-scope
 * SellerPackage that governs pricing and limits for every visitor:
 *
 *  - When an admin creates (or activates) a CV package, it overwrites —
 *    i.e. supersedes — whichever CV package was previously governing the
 *    builder (enforced in routes/admin.ts by deactivating older ones).
 *  - There is no hardcoded fallback price. When the admin removes or
 *    deactivates every CV package, pricing is simply unavailable — the
 *    builder disables the download button until the admin activates a
 *    package again.
 *  - A package's `durationDays` is its validity window counted from its
 *    createdAt date. Once that window elapses the package stops applying
 *    (even if it's still marked active) and pricing again becomes
 *    unavailable until the admin creates a fresh package.
 *  - A package's `maxListings` field doubles, for CV-scope packages, as
 *    the maximum number of CVs a given user/device may generate under it.
 *    `null` means unlimited.
 */
import { prisma } from './prisma';

/**
 * Returns the single CV package currently governing the builder, or null if
 * none is active / the active one's duration window has elapsed (in which
 * case pricing is unavailable and callers must not charge or display any
 * price).
 */
export async function getActiveCvPackage() {
  const pkg = await prisma.sellerPackage.findFirst({
    where: { scope: 'CV', isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!pkg) return null;

  const expiresAt = new Date(pkg.activatedAt ?? pkg.createdAt);
  expiresAt.setDate(expiresAt.getDate() + pkg.durationDays);
  if (expiresAt.getTime() < Date.now()) return null;

  return pkg;
}

/**
 * Counts how many CVs this user (or, for guests, this device) has already
 * generated under the given package. Only tokens that were actually used
 * to complete a download (usedAt set) count towards the limit.
 */
export async function countGenerationsForOwner(
  packageId: string,
  userId?: string | null,
  deviceId?: string | null
): Promise<number> {
  if (!userId && !deviceId) return 0;

  const ownerFilters = [
    userId ? { userId } : null,
    deviceId ? { deviceId } : null,
  ].filter(Boolean) as Array<{ userId: string } | { deviceId: string }>;

  if (ownerFilters.length === 0) return 0;

  return prisma.cvDownloadToken.count({
    where: {
      packageId,
      usedAt: { not: null },
      OR: ownerFilters,
    },
  });
}

/**
 * Resolves everything the frontend needs to render the correct download
 * button + payment flow, and to gate downloads once a package's rules
 * (max generations, duration) have been exhausted. Every price here comes
 * exclusively from the active CV package — there is no hardcoded fallback.
 * When no package is active, `configured` is false and `price` is null;
 * the frontend must disable downloads in that state rather than invent
 * a number.
 */
export async function resolveCvCheckoutContext(opts: {
  country?: string;
  userId?: string | null;
  deviceId?: string | null;
}) {
  const pkg = await getActiveCvPackage();

  if (!pkg) {
    return {
      configured: false,
      package: null as null,
      isFree: false,
      price: null as { amount: number; currency: string } | null,
      limit: null as number | null,
      used: 0,
      limitReached: false,
    };
  }

  const used = await countGenerationsForOwner(pkg.id, opts.userId, opts.deviceId);
  const limit = pkg.maxListings ?? null;
  const limitReached = limit != null && used >= limit;

  return {
    configured: true,
    package: {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      isFree: pkg.isFree,
      price: pkg.price,
      currency: pkg.currency,
      durationDays: pkg.durationDays,
      maxListings: pkg.maxListings,
      createdAt: pkg.createdAt,
      activatedAt: pkg.activatedAt ?? pkg.createdAt,
    },
    isFree: pkg.isFree,
    price: pkg.isFree ? { amount: 0, currency: pkg.currency } : { amount: pkg.price, currency: pkg.currency },
    limit,
    used,
    limitReached,
  };
}
