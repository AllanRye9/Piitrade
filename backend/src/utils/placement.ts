/**
 * Default lifetime of a homepage placement (Flash Deal / Featured Deal /
 * Latest Collections / Back to School) when nobody picks one explicitly.
 * Every code path that sets a placement without an explicit expiry — admin
 * approve, store owners placing their own listings, auto-fill — uses this,
 * so a placement lasts the same time no matter how it was made. Admins can
 * still choose any duration when approving a listing.
 */
export const DEFAULT_PLACEMENT_DAYS = 30;
export const DEFAULT_PLACEMENT_HOURS = DEFAULT_PLACEMENT_DAYS * 24;
export const DEFAULT_PLACEMENT_MS = DEFAULT_PLACEMENT_HOURS * 60 * 60 * 1000;
