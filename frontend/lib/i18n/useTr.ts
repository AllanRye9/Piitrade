'use client';

import { useCallback } from 'react';
import { useLocale } from 'next-intlayer';
import { translate, getOverridesVersion } from './ui';

/** Client hook: `const tr = useTr(); tr('Login')`. Falls back to English. */
export function useTr() {
  const { locale } = useLocale();
  // The version changes when admin-saved translations (Admin → Translations) arrive, so `tr` is re-created then.
  const version = getOverridesVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((text: string) => translate(locale as string, text), [locale, version]);
}
