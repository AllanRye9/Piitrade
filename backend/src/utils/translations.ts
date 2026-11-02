/**
 * translations.ts — admin-managed site translations (table "Translation").
 *
 * A row overrides the built-in text (frontend lib/i18n/ui.ts) for one English source string in one language.
 * The public endpoint serves a {english: translated} map per language; it is cached in memory and the cache is
 * dropped on every admin write, so a saved change is live for the next request (the frontend adds its own
 * short revalidation on top).
 */
import { prisma } from './prisma';

export const MAX_KEY_CHARS = 500;
export const MAX_VALUE_CHARS = 2000;
export const MAX_ENTRIES_PER_REQUEST = 1000;

export interface TranslationEntry { key: string; locale: string; value: string }

/** "lg", "sw", "ach", "pt-BR"… English is the source text and cannot be overridden. */
export function isValidLocale(locale: unknown): locale is string {
  return typeof locale === 'string' && locale !== 'en' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(locale);
}

export interface ValidatedEntries { entries: TranslationEntry[]; errors: string[] }

/** Cleans a client-supplied list; anything unusable is reported, never stored. A blank value means "remove my override". */
export function validateEntries(input: unknown): ValidatedEntries {
  const errors: string[] = [];
  if (!Array.isArray(input)) return { entries: [], errors: ['entries must be a list.'] };
  if (input.length > MAX_ENTRIES_PER_REQUEST) return { entries: [], errors: [`At most ${MAX_ENTRIES_PER_REQUEST} entries per request.`] };
  const byId = new Map<string, TranslationEntry>(); // later duplicates win
  input.forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    const value = typeof r.value === 'string' ? r.value.trim() : '';
    if (!key) return errors.push(`Entry ${i + 1}: the English text is empty.`);
    if (key.length > MAX_KEY_CHARS) return errors.push(`Entry ${i + 1}: the English text is longer than ${MAX_KEY_CHARS} characters.`);
    if (!isValidLocale(r.locale)) return errors.push(`Entry ${i + 1}: "${String(r.locale).slice(0, 12)}" is not a valid language code.`);
    if (value.length > MAX_VALUE_CHARS) return errors.push(`Entry ${i + 1}: the translation is longer than ${MAX_VALUE_CHARS} characters.`);
    if (value.includes('\0') || key.includes('\0')) return errors.push(`Entry ${i + 1}: contains an invalid character.`);
    byId.set(`${r.locale}\u0000${key}`, { key, locale: r.locale as string, value });
  });
  return { entries: [...byId.values()], errors };
}

// ─── Reads (public) ────────────────────────────────────────────────────────────

const TTL_MS = 30_000;
const cache = new Map<string, { map: Record<string, string>; version: string; expires: number }>();

export function invalidateTranslations(): void {
  cache.clear();
}

export async function getTranslationMap(locale: string): Promise<{ map: Record<string, string>; version: string }> {
  const hit = cache.get(locale);
  if (hit && Date.now() < hit.expires) return hit;
  const rows = await prisma.translation.findMany({ where: { locale }, select: { key: true, value: true, updatedAt: true } });
  const map: Record<string, string> = {};
  let latest = 0;
  for (const r of rows) {
    map[r.key] = r.value;
    latest = Math.max(latest, r.updatedAt.getTime());
  }
  const fresh = { map, version: `${rows.length}-${latest}`, expires: Date.now() + TTL_MS };
  cache.set(locale, fresh);
  return fresh;
}

// ─── Writes (admin) ────────────────────────────────────────────────────────────

/** Upserts non-blank entries and deletes blank ones, atomically. Returns how many of each. */
export async function applyEntries(entries: TranslationEntry[], actorEmail: string | null): Promise<{ saved: number; removed: number }> {
  const upserts = entries.filter((e) => e.value !== '');
  const deletes = entries.filter((e) => e.value === '');
  const result = await prisma.$transaction(async (tx) => {
    let saved = 0;
    let removed = 0;
    if (upserts.length) {
      saved = await tx.$executeRawUnsafe(
        `INSERT INTO "Translation" ("id","locale","key","value","updatedBy","createdAt","updatedAt")
         SELECT replace(gen_random_uuid()::text, '-', ''), t.l, t.k, t.v, $4, now(), now()
           FROM unnest($1::text[], $2::text[], $3::text[]) AS t(l, k, v)
         ON CONFLICT ("locale","key") DO UPDATE SET "value" = EXCLUDED."value", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = now()`,
        upserts.map((e) => e.locale), upserts.map((e) => e.key), upserts.map((e) => e.value), actorEmail,
      );
    }
    if (deletes.length) {
      removed = await tx.$executeRawUnsafe(
        `DELETE FROM "Translation" d USING unnest($1::text[], $2::text[]) AS t(l, k) WHERE d."locale" = t.l AND d."key" = t.k`,
        deletes.map((e) => e.locale), deletes.map((e) => e.key),
      );
    }
    return { saved, removed };
  });
  invalidateTranslations();
  return result;
}
