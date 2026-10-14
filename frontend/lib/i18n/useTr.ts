'use client';

import { useCallback } from 'react';
import { useLocale } from 'next-intlayer';
import { translate } from './ui';

/** Client hook: `const tr = useTr(); tr('Login')`. Falls back to English. */
export function useTr() {
  const { locale } = useLocale();
  return useCallback((text: string) => translate(locale as string, text), [locale]);
}
