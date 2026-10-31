/**
 * contentSafety.ts — the "security checkpoint" every uploaded photo passes BEFORE it is stored or shown
 * to an admin. Benchmark: categories of content that are prohibited essentially everywhere (child sexual
 * exploitation, sexual/explicit material, graphic violence & gore, terrorism/extremism, real firearms,
 * explosives & military weapons, hard drugs, trafficking in people/organs/endangered wildlife, counterfeit
 * money & documents).
 *
 * How it works
 *  1. The image-AI worker describes the photo (vision-language model) and lists classifier labels.
 *  2. `evaluateDescription` applies the policy to that text (deterministic, unit-tested).
 *  3. If an LLM is configured, it gives a second opinion on the description.
 *  Verdicts: PASSED · REVIEW (allowed, flagged for the admin) · BLOCKED (rejected, never stored) ·
 *  UNSCREENED (service unreachable: allowed but flagged; set IMAGE_SAFETY_STRICT=true to block instead).
 */
import { callLLMJson, isLLMConfigured } from '../lib/llm';
import { logger } from './logger';

export type SafetyVerdict = 'PASSED' | 'REVIEW' | 'BLOCKED' | 'UNSCREENED';
export interface SafetyResult { status: SafetyVerdict; category?: string; reason?: string }

interface Rule { category: string; severity: 'BLOCK' | 'REVIEW'; re: RegExp; reason: string }

const PERSON = '(?:man|men|woman|women|girl|boy|person|people|body|bodies|lady|ladies|child|children|baby|teen\\w*|model)';
const MINOR = '(?:child|children|kid|kids|minor|minors|boy|girl|baby|toddler|teen\\w*|underage|young)';
const TOY = '(?:toy|toys|replica|airsoft|nerf|water|cap|paintball|plastic|bb|model|prop|costume|glue|spray|paint|nail|staple|grease)';

const RULES: Rule[] = [
  { category: 'child-safety', severity: 'BLOCK', reason: 'content that sexualises or exploits children',
    re: new RegExp(`\\b(?:nude|naked|undressed|topless|sexual\\w*|explicit|porn\\w*)\\b[^.]{0,60}\\b${MINOR}\\b|\\b${MINOR}\\b[^.]{0,60}\\b(?:nude|naked|undressed|topless|sexual\\w*|explicit|porn\\w*)\\b`, 'i') },
  { category: 'sexual-content', severity: 'BLOCK', reason: 'nudity or sexually explicit material',
    re: new RegExp(`\\b(?:nude|naked|topless|undressed|unclothed)\\s+${PERSON}\\b|\\bnudity\\b|\\bporn\\w*|\\bgenitals?\\b|\\bgenitalia\\b|\\berotic\\b|\\bsexual (?:act|intercourse|content)\\b|\\bhaving sex\\b|\\bsex (?:toy|act|scene)\\b|\\bexposed (?:breasts?|buttocks)\\b`, 'i') },
  { category: 'graphic-violence', severity: 'BLOCK', reason: 'graphic violence, gore or human remains',
    re: /\b(?:gore|gory|corpses?|dead bod(?:y|ies)|severed|beheaded|decapitat\w+|mutilat\w+|dismember\w+|murder scene|bloody (?:body|bodies|person|man|woman|child)|blood[- ]soaked|human (?:remains|skull|bones|organs?))\b/i },
  { category: 'weapons', severity: 'BLOCK', reason: 'firearms, explosives or military weapons',
    re: /\b(?:assault rifles?|machine guns?|ak-?47|automatic rifles?|submachine guns?|grenades?|explosives?|(?<!bath |photo )bombs?|landmines?|rocket launchers?|detonators?|ammunition|live rounds)\b/i },
  { category: 'weapons', severity: 'BLOCK', reason: 'firearms, explosives or military weapons',
    re: new RegExp(`\\b(?<!${TOY}\\s)(?:pistols?|revolvers?|handguns?|firearms?|rifles?|shotguns?)\\b`, 'i') },
  { category: 'drugs', severity: 'BLOCK', reason: 'illegal drugs',
    re: /\b(?:cocaine|heroin|methamphetamine|crystal meth|opium|lsd|mdma|ecstasy pills?|cannabis|marijuana|hashish|ganja|drug paraphernalia|crack pipe)\b/i },
  { category: 'drugs', severity: 'REVIEW', reason: 'possible illegal substances',
    re: /\b(?:white powder|bags? of powder|syringes? and (?:powder|spoon))\b/i },
  { category: 'wildlife', severity: 'BLOCK', reason: 'endangered-wildlife products',
    re: /\b(?:elephant tusks?|tusks?|rhino(?:ceros)? horns?|pangolin(?: scales?)?|ivory (?:tusk|carving|statue|bracelet|jewel\w*|piece)|poached)\b/i },
  { category: 'counterfeit', severity: 'BLOCK', reason: 'counterfeit money or forged documents',
    re: /\b(?:counterfeit|forged|fake|prop) (?:money|currency|banknotes?|notes|cash|id|ids|passports?|documents?|visas?|certificates?)\b|\bcounterfeit\b/i },
  { category: 'extremism', severity: 'BLOCK', reason: 'terrorism, extremist or hate content',
    re: /\b(?:isis|al-?qaeda|al-?shabaab|terroris\w+|extremis\w+|kkk|nazi|neo-?nazi|hate symbols?|white supremacist)\b/i },
  { category: 'extremism', severity: 'REVIEW', reason: 'a symbol that may be hateful',
    re: /\bswastikas?\b/i },
  { category: 'weapons', severity: 'REVIEW', reason: 'a blade or weapon-like item',
    re: /\b(?:machetes?|daggers?|swords?|crossbows?|knuckle[- ]?dusters?|brass knuckles)\b/i },
];

// ImageNet-style classifier labels that merit a human look (never an automatic block: the classifier is coarse).
const REVIEW_LABELS = /\b(?:assault rifle|rifle|revolver|holster|cleaver|bikini|brassiere|maillot)\b/i;

/** Deterministic policy check on the AI's text description (+ optional classifier labels). */
export function evaluateDescription(description: string, labels: { label: string; confidence: number }[] = []): SafetyResult {
  const text = (description || '').replace(/\s+/g, ' ').trim();
  let review: SafetyResult | null = null;
  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    if (rule.severity === 'BLOCK') return { status: 'BLOCKED', category: rule.category, reason: rule.reason };
    review ??= { status: 'REVIEW', category: rule.category, reason: rule.reason };
  }
  if (!review) {
    const hit = labels.find((l) => l.confidence >= 0.6 && REVIEW_LABELS.test(l.label));
    if (hit) review = { status: 'REVIEW', category: 'classifier', reason: `classifier suggests “${hit.label}”` };
  }
  return review ?? { status: 'PASSED' };
}

const IMAGE_AI_URL = (process.env.IMAGE_AI_URL || process.env.NEXT_PUBLIC_IMAGE_AI_URL || 'https://apkit.allan-rye-999.workers.dev').replace(/\/+$/, '');
const AI_TIMEOUT_MS = 15_000;

async function workerJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${IMAGE_AI_URL}${path}`, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return data && data.success !== false ? data : null;
  } catch {
    return null;
  }
}

interface LlmSafety { prohibited: boolean; category?: string; confidence?: number }
const LLM_SYSTEM = 'You are a trust-and-safety classifier for a classifieds marketplace. Given an automatic description of a photo, decide whether the photo shows content that is prohibited everywhere: child sexual exploitation, nudity or sexually explicit material, graphic violence or gore, terrorism or hate symbols, real firearms or explosives, illegal drugs, human/organ/endangered-wildlife trafficking, counterfeit money or documents. Ordinary goods (clothes, toys, kitchen knives, replicas) are allowed. Reply ONLY with JSON: {"prohibited": boolean, "category": string, "confidence": number between 0 and 1}.';

/** Screens one already-hosted, publicly reachable image URL. Never throws. */
export async function screenImageUrl(url: string): Promise<SafetyResult> {
  const strict = process.env.IMAGE_SAFETY_STRICT === 'true';
  const unavailable = (): SafetyResult => strict
    ? { status: 'BLOCKED', category: 'unverified', reason: 'we could not verify this photo right now — please try again in a moment' }
    : { status: 'UNSCREENED', reason: 'safety check unavailable' };
  try {
    if (!/^https?:\/\//i.test(url)) return unavailable(); // local/relative URLs are not reachable by the AI service
    const [identify, classify] = await Promise.all([
      workerJson(`/identify?url=${encodeURIComponent(url)}`),
      workerJson(`/classify?url=${encodeURIComponent(url)}`),
    ]);
    const description = typeof identify?.description === 'string' ? identify.description : '';
    if (!description) return unavailable();
    const labels = Array.isArray(classify?.predictions) ? (classify!.predictions as { label: string; confidence: number }[]) : [];
    const policy = evaluateDescription(description, labels);
    if (policy.status === 'BLOCKED') return policy;
    if (isLLMConfigured()) {
      const second = await callLLMJson<LlmSafety>(LLM_SYSTEM, `Photo description: ${description.slice(0, 1500)}`);
      if (second && second.prohibited === true && (second.confidence ?? 0) >= 0.8) {
        return { status: 'BLOCKED', category: String(second.category || 'prohibited').slice(0, 40), reason: 'content that is not allowed on the marketplace' };
      }
      if (second && second.prohibited === true && policy.status === 'PASSED') {
        return { status: 'REVIEW', category: String(second.category || 'prohibited').slice(0, 40), reason: 'flagged by the AI second opinion' };
      }
    }
    return policy;
  } catch (err) {
    logger.warn(`Image safety screening failed: ${String(err)}`);
    return unavailable();
  }
}
