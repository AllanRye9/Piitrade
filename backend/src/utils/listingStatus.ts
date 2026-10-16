/**
 * listingStatus.ts — which status changes a listing's OWNER may make.
 *
 * PATCH /listings/:id/status accepted ACTIVE from any state, and PUT
 * /listings/:id accepted ANY status from the body. That let a seller:
 *   - publish a PENDING listing without admin approval,
 *   - reactivate a listing the AI moderator auto-rejected,
 *   - undo an admin "Remove listing" (which sets HIDDEN) after a report.
 * Owners may now only do the things below; everything else is admin-only.
 */
export type ListingStatusName = 'ACTIVE' | 'PENDING' | 'SOLD' | 'EXPIRED' | 'HIDDEN' | 'REJECTED';

const OWNER_TRANSITIONS: Record<ListingStatusName, ListingStatusName[]> = {
  ACTIVE: ['SOLD', 'HIDDEN'],
  SOLD: ['ACTIVE', 'HIDDEN'],
  HIDDEN: ['ACTIVE', 'SOLD'],
  REJECTED: ['PENDING'], // resubmit for human review — never straight to live
  PENDING: [],           // waiting on a moderator
  EXPIRED: [],           // renewal is an admin/payment action
};

export function ownerMayChangeStatus(from: string, to: string): boolean {
  if (from === to) return true; // no-op
  return (OWNER_TRANSITIONS[from as ListingStatusName] ?? []).includes(to as ListingStatusName);
}
