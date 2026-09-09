import { t, type Dictionary } from 'intlayer';

/**
 * TRANSLATION QUALITY NOTE: `en` and `lg` (Luganda) are reasonably reliable.
 * `sw` (Kiswahili) is an AI best-effort first pass — Swahili has more
 * training data than Uganda's other local languages, so this should be
 * more reliable than the ach/nyn/lam/teo drafts this file used to carry,
 * but it should still get a native-speaker review before being treated as
 * final.
 */
const content = {
  key: 'mobileBottomNav',
  content: {
    home: t({
      en: 'Home',
      lg: 'Awaka',
      sw: 'Nyumbani',
    }),
    browse: t({
      en: 'Browse',
      lg: 'Noonya',
      sw: 'Vinjari',
    }),
    sell: t({
      en: 'Sell',
      lg: 'Tunda',
      sw: 'Uza',
    }),
    account: t({
      en: 'Account',
      lg: 'Akawunti',
      sw: 'Akaunti',
    }),
  },
} satisfies Dictionary;

export default content;
