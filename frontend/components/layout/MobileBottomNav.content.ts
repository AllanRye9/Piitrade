import { t, type Dictionary } from 'intlayer';

/**
 * TRANSLATION QUALITY NOTE: `en` and `lg` (Luganda) are reasonably reliable.
 * `sw` (Kiswahili) and `ach` (Acoli) are AI-drafted first passes — see
 * language_translation.xlsx (2026-09-23 export) — and should get a
 * native-speaker review before being treated as final. `ach` is staged
 * ahead of `ach` being added to `locales` in intlayer.config.ts (not
 * rendered until then).
 */
const content = {
  key: 'mobileBottomNav',
  content: {
    home: t({
      en: 'Home',
      lg: 'Awaka',
      sw: 'Nyumbani',
      ach: 'Gang',
    }),
    browse: t({
      en: 'Browse',
      lg: 'Noonya',
      sw: 'Vinjari',
      ach: 'Yenyo',
    }),
    chats: t({
      en: 'Chats',
      lg: 'Emboozi',
      sw: 'Mazungumzo',
      ach: 'Lok',
    }),
    sell: t({
      en: 'Sell',
      lg: 'Tunda',
      sw: 'Uza',
      ach: 'Catto',
    }),
    account: t({
      en: 'Account',
      lg: 'Akawunti',
      sw: 'Akaunti',
      ach: 'Akawunti',
    }),
  },
} satisfies Dictionary;

export default content;
