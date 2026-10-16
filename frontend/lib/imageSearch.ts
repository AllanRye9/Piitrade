// Search-by-photo. Re-uses the exact same image-AI worker calls as the AI
// auto-fill on /listings/create (identifyImageUrl = vision-language
// description, classifyImageUrl = ResNet-50 labels), but turns the result
// into search terms instead of listing fields.
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';
import { classifyImageUrl, identifyImageUrl, ImageAiError } from '@/lib/imageAi';

export interface VisualMatch {
  id: string;
  title: string;
  price: number;
  currency: string;
  location: string | null;
  image: string;
  score: number;
}

export interface ImageSearchResult {
  /** Best single query — verified to return live listings when possible. */
  query: string;
  /** Alternative, broader terms the visitor can tap (classifier labels). */
  alternatives: string[];
  /** Raw one-sentence description of what the photo shows. */
  description: string;
  /** Number of live listings the chosen query matches (0 if unknown). */
  count: number;
  /** Categories that fit the photo, used when the query itself finds nothing. */
  categories: { name: string; slug: string }[];
  /** Listings whose photos look like the uploaded one (visual fingerprint). */
  visualMatches: VisualMatch[];
}

const FILLER = [
  /^(this|the|that)\s+(is|shows?|appears? to be|looks? like)\s+/i,
  /^(a|an|the)?\s*(close[- ]?up\s+)?(photo|picture|image|shot)\s+(of|showing)\s+/i,
  /^there\s+(is|are)\s+/i,
  /^(a|an|the|some)\s+/i,
];
const STOP = new Set(['with', 'on', 'in', 'sitting', 'placed', 'against', 'next', 'that', 'which', 'and', 'is', 'are', 'its', 'it', 'has', 'having', 'featuring', 'displayed', 'shown', 'standing', 'lying', 'resting', 'from', 'at', 'by']);

function cleanTerm(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s\-+.]/gu, '').trim();
}

/** "A silver Samsung Galaxy S21 smartphone on a wooden table." -> "silver Samsung Galaxy S21 smartphone" */
export function queryFromDescription(description: string): string {
  let base = (description || '').trim();
  for (let i = 0; i < 2; i++) for (const re of FILLER) base = base.replace(re, '');
  base = base.split(/[.!?;]|,\s+/)[0] || base;
  const words: string[] = [];
  for (const w of base.split(/\s+/)) {
    if (words.length >= 3 && STOP.has(w.toLowerCase())) break;
    words.push(w);
    if (words.length >= 7) break;
  }
  return cleanTerm(words.join(' '));
}

/** Uploads the photo to a short-lived public URL the AI worker can fetch. */
async function uploadForSearch(file: File): Promise<{ url: string; matches: VisualMatch[] }> {
  const form = new FormData();
  form.append('image', file);
  try {
    const { data } = await api.post('/upload/search', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
    if (!data?.url) throw new Error('missing url');
    return { url: resolveImageUrl(data.url as string), matches: Array.isArray(data.matches) ? (data.matches as VisualMatch[]) : [] };
  } catch (err) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    throw new ImageAiError(msg || 'Could not upload the photo. Please try a smaller JPG or PNG.');
  }
}

/** Runs an AI call with a timeout and one retry — the worker can cold-start slowly. */
async function resilient<T>(fn: () => Promise<T>, timeoutMs = 25000, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new ImageAiError('The image AI took too long to respond.')), timeoutMs)),
      ]);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Photo search, using several independent methods so one failing never means
 * "no result":
 *   1. Vision-language description  (what the item is, brand/model level)
 *   2. Classifier labels            (broader object names)
 *   3. Visual fingerprint match     (listings whose photos look alike — server side)
 *   4. Query ladder + categories    (server verifies the terms really have listings,
 *                                    relaxes them if not, and suggests categories)
 */
export async function searchByImage(file: File): Promise<ImageSearchResult> {
  const { url, matches } = await uploadForSearch(file);
  const [identify, classify] = await Promise.allSettled([
    resilient(() => identifyImageUrl(url)),
    resilient(() => classifyImageUrl(url)),
  ]);

  const description = identify.status === 'fulfilled' ? identify.value.description.trim() : '';
  const labels = classify.status === 'fulfilled'
    ? classify.value.predictions
        .filter((p) => p.confidence >= 0.05)
        .slice(0, 5)
        .map((p) => cleanTerm(p.label.split(',')[0]))
        .filter(Boolean)
    : [];

  const fromDescription = queryFromDescription(description);
  const candidates = [fromDescription, ...labels].filter(Boolean);

  let query = candidates[0] || '';
  let count = 0;
  let categories: { name: string; slug: string }[] = [];
  if (candidates.length) {
    try {
      const { data } = await api.post('/listings/image-match', { queries: fromDescription ? [fromDescription] : [], labels });
      if (data?.query) { query = data.query as string; count = (data.count as number) || 0; }
      if (Array.isArray(data?.categories)) categories = data.categories as { name: string; slug: string }[];
    } catch { /* keep the unverified query */ }
  }

  if (!query && matches.length === 0) {
    const reason =
      (identify.status === 'rejected' && (identify.reason as Error)?.message) ||
      (classify.status === 'rejected' && (classify.reason as Error)?.message) ||
      "We couldn't recognise anything in that photo. Try a clearer picture of a single item.";
    throw new ImageAiError(reason);
  }

  const seen = new Set([query.toLowerCase()]);
  const alternatives = [fromDescription, ...labels].filter((l) => {
    if (!l) return false;
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { query, alternatives, description, count, categories, visualMatches: matches };
}
