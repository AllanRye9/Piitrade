/**
 * Photo mismatch detection shared by every listing-posting form.
 *
 * Compares what the image-AI classifier sees in each extra photo against the FIRST photo of the
 * listing (the one the seller treats as "the item"). A photo is flagged when its top labels share
 * nothing with the first photo's (see `matchesSameItem`). It is a heuristic, so callers must show
 * the flagged photos to the seller and let them confirm or remove — never silently reject.
 *
 * Fails open by design: if the image-AI service is unreachable, or a single photo cannot be
 * classified, that photo is simply not flagged, so an outage never blocks anyone from posting.
 */
import { classifyImageUrl } from '@/lib/imageAi';
import { matchesSameItem } from '@/lib/categoryMatch';
import { resolveImageUrl } from '@/lib/utils';

/** Labels already fetched per photo, so re-checking an unchanged photo costs nothing. */
const labelCache = new Map<string, string[]>();

/** Only photos already on the server can be classified; local blob:/data: previews cannot. */
export function isCheckablePhoto(src: string): boolean {
  return !!src && !src.startsWith('blob:') && !src.startsWith('data:');
}

async function labelsFor(src: string): Promise<string[]> {
  const hit = labelCache.get(src);
  if (hit) return hit;
  const r = await classifyImageUrl(resolveImageUrl(src));
  const labels = r.predictions.slice(0, 3).map((p) => p.label);
  labelCache.set(src, labels);
  return labels;
}

export interface PhotoCheckResult {
  /** Photos (as passed in) that do not look like the first photo. Never includes the first photo. */
  flagged: string[];
  /** Per-photo verdict for every photo that could be checked (keyed by the src passed in). */
  statuses: Record<string, 'matched' | 'unmatched'>;
  /** True when the first photo could not be classified, so nothing was checked. */
  unavailable: boolean;
}

/**
 * @param srcs       the listing's photos, first photo first
 * @param baseHints  labels for the first photo if the caller already has them (skips one request)
 */
export async function findMismatchedPhotos(srcs: string[], baseHints?: string[]): Promise<PhotoCheckResult> {
  const checkable = srcs.filter(isCheckablePhoto);
  const empty: PhotoCheckResult = { flagged: [], statuses: {}, unavailable: false };
  if (checkable.length < 2) return empty;

  let hints = baseHints && baseHints.length > 0 ? baseHints : null;
  if (!hints) {
    try {
      hints = await labelsFor(checkable[0]);
    } catch {
      return { ...empty, unavailable: true };
    }
  }

  const statuses: PhotoCheckResult['statuses'] = {};
  await Promise.all(
    checkable.slice(1).map(async (src) => {
      try {
        const labels = await labelsFor(src);
        statuses[src] = matchesSameItem(hints!, labels).isMatch ? 'matched' : 'unmatched';
      } catch {
        /* this photo could not be checked — do not flag it */
      }
    })
  );
  // keep the order the photos appear in the form
  const flagged = checkable.slice(1).filter((src) => statuses[src] === 'unmatched');
  return { flagged, statuses, unavailable: false };
}
