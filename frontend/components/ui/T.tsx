'use client';

import { useTr } from '@/lib/i18n/useTr';

/**
 * Inline translated text: `<T>Sign In</T>`. Looks the English source string up in
 * lib/i18n/ui.ts for the active locale and falls back to the English text, so it
 * is safe to wrap any static string. Works inside server components too.
 */
export function T({ children }: { children: string }) {
  const tr = useTr();
  return <>{tr(children)}</>;
}
