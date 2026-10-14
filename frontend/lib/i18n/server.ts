import { getLocale } from 'next-intlayer/server';
import { translate } from './ui';

/** Server components: `const tr = await getTr(); tr('Blog')`. */
export async function getTr() {
  const locale = await getLocale();
  return (text: string) => translate(locale as string, text);
}
