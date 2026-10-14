// Search-by-photo. Re-uses the exact same image-AI worker calls as the AI
// auto-fill on /listings/create (identifyImageUrl = vision-language
// description, classifyImageUrl = ResNet-50 labels), but turns the result
// into search terms instead of listing fields.
import { api } from '@/lib/api';
import { resolveImageUrl } from '@/lib/utils';
import { classifyImageUrl, identifyImageUrl, ImageAiError } from '@/lib/imageAi';

export interface ImageSearchResult {
  /** Best single query (brand/model-level wording from the vision model). */
  query: string;
  /** Alternative, broader terms the visitor can tap (classifier labels). */
  alternatives: string[];
  /** Raw one-sentence description of what the photo shows. */
  description: string;
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
async function uploadForSearch(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  try {
    const { data } = await api.post('/upload/search', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    if (!data?.url) throw new Error('missing url');
    return resolveImageUrl(data.url as string);
  } catch (err) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    throw new ImageAiError(msg || 'Could not upload the photo. Please try a smaller JPG or PNG.');
  }
}

export async function searchByImage(file: File): Promise<ImageSearchResult> {
  const url = await uploadForSearch(file);
  const [identify, classify] = await Promise.allSettled([identifyImageUrl(url), classifyImageUrl(url)]);

  const description = identify.status === 'fulfilled' ? identify.value.description.trim() : '';
  const labels = classify.status === 'fulfilled'
    ? classify.value.predictions
        .filter((p) => p.confidence >= 0.05)
        .slice(0, 4)
        .map((p) => cleanTerm(p.label.split(',')[0]))
        .filter(Boolean)
    : [];

  const fromDescription = queryFromDescription(description);
  const query = fromDescription || labels[0] || '';
  if (!query) {
    const reason =
      (identify.status === 'rejected' && (identify.reason as Error)?.message) ||
      (classify.status === 'rejected' && (classify.reason as Error)?.message) ||
      "We couldn't recognise anything in that photo. Try a clearer picture of a single item.";
    throw new ImageAiError(reason);
  }

  const seen = new Set([query.toLowerCase()]);
  const alternatives = labels.filter((l) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { query, alternatives, description };
}
