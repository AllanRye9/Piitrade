'use client';

import { registerOverrides } from '@/lib/i18n/ui';

/**
 * Hands the admin-saved translations (Admin → Translations) for the active language to the client-side
 * `tr()` / `<T>` lookups. Registering happens during render, before any child renders, so the very first
 * server-rendered and hydrated HTML already contains the saved text (no flash of the built-in wording).
 */
export function TranslationsProvider({ locale, strings, children }: { locale: string; strings: Record<string, string>; children: React.ReactNode }) {
  registerOverrides(locale, strings);
  return <>{children}</>;
}
