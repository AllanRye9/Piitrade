// Languages an admin can translate into (English is the source text). Codes must match `locales` in
// intlayer.config.ts; to add a language, add it there, to LocaleSwitcher.tsx, and here.
export const TRANSLATABLE_LOCALES = [
  { code: 'lg', name: 'Luganda' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'ach', name: 'Acoli' },
] as const;

export type TranslatableLocale = (typeof TRANSLATABLE_LOCALES)[number]['code'];

/** Header cells accepted in an uploaded file, mapped to a language code (case-insensitive). */
export const LOCALE_ALIASES: Record<string, string> = {
  lg: 'lg', luganda: 'lg', ganda: 'lg',
  sw: 'sw', swahili: 'sw', kiswahili: 'sw',
  ach: 'ach', acoli: 'ach', acholi: 'ach',
};
