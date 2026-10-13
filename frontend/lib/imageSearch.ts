// Search-by-photo. Re-uses the exact same image-AI worker calls as the AI
// auto-fill on /listings/create (identifyImageUrl = vision-language
// description, classifyImageUrl = ResNet-50 labels), but turns the result
// into search terms instead of listing fields.
//
// The listings search requires EVERY word to match (see backend utils/search),
// so a long, descriptive query ("silver Samsung Galaxy S21 smartphone") often
// returns nothing. We therefore produce an ordered list of progressively
// simpler `candidates`; the results page walks down that list automatically
// when a query comes back empty.
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';
import { classifyImageUrl, identifyImageUrl, ImageAiError } from '@/lib/imageAi';

export interface ImageSearchResult {
  /** Best single query to run first. */
  query: string;
  /** Ordered fallbacks, simplest last. Always starts with `query`. */
  candidates: string[];
  /** Alternative, broader terms the visitor can tap. (= candidates without `query`) */
  alternatives: string[];
  /** Raw one-sentence description of what the photo shows. */
  description: string;
}

/** sessionStorage key shared with HeaderSearch + the listings page. */
export const IMAGE_SEARCH_STORAGE_KEY = 'piitrade_image_alts';

const AI_TIMEOUT_MS = 30_000;

/**
 * Reads the candidate list saved by the header search. Defensive: sessionStorage
 * can be unavailable (private mode) or hold data from an older app version.
 */
export function readImageCandidates(): string[] {
  try {
    const raw = window.sessionStorage.getItem(IMAGE_SEARCH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const pool = parsed && Array.isArray(parsed.candidates) ? parsed.candidates : parsed && Array.isArray(parsed.alts) ? parsed.alts : [];
    return pool.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0);
  } catch {
    return [];
  }
}

/** The next, simpler query to try after `current` returned nothing (or null at the end of the list). */
export function nextPhotoCandidate(current: string, candidates: string[]): string | null {
  const idx = candidates.findIndex((c) => c.toLowerCase() === current.trim().toLowerCase());
  return idx >= 0 && idx + 1 < candidates.length ? candidates[idx + 1] : null;
}

const FILLER = [
  /^(this|the|that)\s+(is|shows?|appears? to be|looks? like)\s+/i,
  /^(a|an|the)?\s*(close[- ]?up\s+)?(photo|picture|image|shot)\s+(of|showing)\s+/i,
  /^there\s+(is|are)\s+/i,
  /^(a|an|the|some)\s+/i,
];
const STOP = new Set(['with', 'on', 'in', 'sitting', 'placed', 'against', 'next', 'that', 'which', 'and', 'is', 'are', 'its', 'it', 'has', 'having', 'featuring', 'displayed', 'shown', 'standing', 'lying', 'resting', 'from', 'at', 'by', 'for', 'of']);

// Words that describe how an item looks rather than what it is. Listing titles
// rarely contain them, and because search is AND-based they cause misses.
const DESCRIPTIVE = new Set([
  'black', 'white', 'silver', 'gold', 'golden', 'grey', 'gray', 'red', 'blue', 'green', 'yellow', 'orange', 'pink', 'purple', 'brown', 'beige', 'cream', 'navy', 'rose', 'tan', 'dark', 'light', 'bright',
  'small', 'large', 'big', 'little', 'tiny', 'huge', 'medium', 'tall', 'long', 'short', 'wide', 'thin', 'thick',
  'new', 'old', 'used', 'vintage', 'modern', 'classic', 'shiny', 'metallic', 'colorful', 'colourful', 'plain', 'striped', 'floral',
  'wooden', 'plastic', 'leather', 'metal', 'glass', 'cotton', 'ceramic', 'stainless', 'steel',
  'open', 'closed', 'empty', 'full', 'single', 'pair', 'set', 'two', 'three', 'several', 'various', 'assorted',
]);

// ImageNet labels / AI nouns -> the words people actually put in listing titles.
const SYNONYMS: Record<string, string> = {
  'cellular telephone': 'phone', 'cellular phone': 'phone', 'cell phone': 'phone', 'cellphone': 'phone', 'mobile phone': 'phone', 'smartphone': 'phone', 'ipod': 'phone', 'dial telephone': 'phone',
  'laptop computer': 'laptop', 'laptop': 'laptop', 'notebook': 'laptop', 'notebook computer': 'laptop', 'desktop computer': 'computer', 'monitor': 'monitor', 'screen': 'monitor',
  'television': 'tv', 'television set': 'tv', 'television receiver': 'tv', 'flat screen': 'tv',
  'running shoe': 'shoes', 'sneaker': 'shoes', 'sneakers': 'shoes', 'loafer': 'shoes', 'sandal': 'sandals', 'clog': 'shoes', 'boot': 'boots', 'cowboy boot': 'boots',
  'jean': 'jeans', 'denim': 'jeans', 'jersey': 'shirt', 'tee shirt': 'shirt', 't-shirt': 'shirt', 'sweatshirt': 'hoodie', 'abaya': 'dress', 'gown': 'dress',
  'handbag': 'bag', 'purse': 'bag', 'backpack': 'bag', 'mailbag': 'bag', 'wallet': 'wallet',
  'wristwatch': 'watch', 'digital watch': 'watch', 'analog clock': 'watch',
  'sofa': 'sofa', 'studio couch': 'sofa', 'couch': 'sofa', 'dining table': 'table', 'four-poster': 'bed', 'bassinet': 'bed', 'crib': 'bed', 'wardrobe': 'wardrobe', 'chiffonier': 'wardrobe',
  'refrigerator': 'fridge', 'icebox': 'fridge', 'microwave': 'microwave', 'washer': 'washing machine', 'washing machine': 'washing machine',
  'racer': 'car', 'sports car': 'car', 'convertible': 'car', 'minivan': 'car', 'limousine': 'car', 'cab': 'car', 'jeep': 'car', 'pickup': 'pickup truck', 'moped': 'motorcycle', 'motor scooter': 'scooter',
  'headphone': 'headphones', 'headset': 'headphones', 'earphone': 'earphones', 'speaker': 'speaker', 'loudspeaker': 'speaker', 'camera': 'camera', 'reflex camera': 'camera',
  'cock': 'chicken', 'hen': 'chicken', 'banana': 'banana', 'pineapple': 'pineapple', 'corn': 'maize', 'ear': 'maize',
};

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

function synonym(term: string): string {
  const k = term.toLowerCase().trim();
  return SYNONYMS[k] ?? SYNONYMS[k.replace(/s$/, '')] ?? term;
}

/**
 * Builds progressively simpler queries from a description-style phrase:
 *   "silver Samsung Galaxy S21 smartphone"
 *   -> ["silver Samsung Galaxy S21 smartphone", "Samsung Galaxy S21 smartphone", "Samsung Galaxy S21", "phone"]
 */
export function simplifyQuery(query: string): string[] {
  const out: string[] = [];
  const push = (s: string) => { const c = cleanTerm(s); if (c) out.push(c); };
  push(query);
  const words = cleanTerm(query).split(' ').filter(Boolean);
  const kept = words.filter((w) => !DESCRIPTIVE.has(w.toLowerCase()));
  if (kept.length && kept.length !== words.length) push(kept.join(' '));
  if (kept.length > 2) {
    // Brand/model usually leads and the generic noun trails: drop the noun first, then fall back to just the noun.
    push(kept.slice(0, -1).join(' '));
    push(kept[kept.length - 1]);
  } else if (kept.length === 2) {
    push(kept[kept.length - 1]);
  }
  // Last-resort generic term via synonyms (smartphone -> phone).
  const head = kept[kept.length - 1] || words[words.length - 1] || '';
  const syn = synonym(head);
  if (syn && syn.toLowerCase() !== head.toLowerCase()) push(syn);
  return out;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = s.toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ImageAiError(message)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * The image-AI worker fetches the photo itself, so the URL must be absolute and
 * reachable from the public internet. Fail early with an actionable message
 * instead of a vague "image AI request failed".
 */
export function assertPublicImageUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageAiError('Photo search is not configured: the backend URL is missing (set NEXT_PUBLIC_API_URL and rebuild the frontend).');
  }
  const host = parsed.hostname;
  const isPrivate = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal')
    || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || !host.includes('.');
  if (isPrivate) {
    throw new ImageAiError('Photo search only works when the backend is publicly reachable (the AI service has to download the photo). Try it on the deployed site.');
  }
  return url;
}

/** Uploads the photo to a short-lived public URL the AI worker can fetch. */
async function uploadForSearch(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  let rawUrl: string;
  try {
    const { data } = await api.post('/upload/search', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 45_000,
    });
    if (!data?.url) throw new Error('missing url');
    rawUrl = data.url as string;
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { message?: string } }; code?: string };
    if (e.response?.status === 429) throw new ImageAiError(e.response.data?.message || 'Too many photo searches. Please wait a few minutes and try again.');
    const msg = e.response?.data?.message;
    throw new ImageAiError(msg || (e.code === 'ECONNABORTED' ? 'The upload timed out. Please try a smaller photo.' : 'Could not upload the photo. Please try a smaller JPG or PNG.'));
  }
  return assertPublicImageUrl(resolveImageUrl(rawUrl));
}

export async function searchByImage(file: File): Promise<ImageSearchResult> {
  const url = await uploadForSearch(file);
  const timeoutMsg = 'The photo analysis took too long. Please try again or use a clearer photo.';
  const [identify, classify] = await Promise.allSettled([
    withTimeout(identifyImageUrl(url), AI_TIMEOUT_MS, timeoutMsg),
    withTimeout(classifyImageUrl(url), AI_TIMEOUT_MS, timeoutMsg),
  ]);

  const description = identify.status === 'fulfilled' ? identify.value.description.trim() : '';
  const labels = classify.status === 'fulfilled'
    ? classify.value.predictions
        .filter((p) => p.confidence >= 0.05)
        .slice(0, 4)
        .map((p) => cleanTerm(p.label.split(',')[0]))
        .filter(Boolean)
    : [];

  const fromDescription = queryFromDescription(description);
  const primary = fromDescription || (labels[0] ? synonym(labels[0]) : '');
  if (!primary) {
    const reason =
      (identify.status === 'rejected' && (identify.reason as Error)?.message) ||
      (classify.status === 'rejected' && (classify.reason as Error)?.message) ||
      "We couldn't recognise anything in that photo. Try a clearer picture of a single item.";
    throw new ImageAiError(reason);
  }

  const candidates = dedupe([
    ...simplifyQuery(primary),
    ...labels.flatMap((l) => [synonym(l), l]),
  ]);
  return { query: candidates[0], candidates, alternatives: candidates.slice(1, 5), description };
}
