import { getLocale } from 'next-intlayer/server';
import { translate } from './ui';
import { fetchOverrides } from './overrides';

/** Server components: `const tr = await getTr(); tr('Blog')`. Admin-saved translations win over the built-in ones. */
export async function getTr() {
  const locale = (await getLocale()) as string;
  const overrides = await fetchOverrides(locale);
  return (text: string) => overrides[text] ?? translate(locale, text);
}
