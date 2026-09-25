import { t, type Dictionary } from "intlayer";

// en, lg (Luganda), sw (Kiswahili), and ach (Acoli, drafted 2026-09-23 —
// see language_translation.xlsx) — `en` and `lg` are reviewed; `sw` and
// `ach` are best-effort first passes and should still get a native-speaker
// review before being treated as final. `ach` is staged ahead of it being
// added to `locales` in intlayer.config.ts and isn't rendered until then.
const localeSwitcherContent = {
  key: "locale-switcher",
  content: {
    ariaLabel: t({
      en: 'Select language',
      lg: 'Londa olulimi',
      sw: 'Chagua lugha',
      ach: 'Yer leb',
    }),
    regionLabel: t({
      en: 'Language',
      lg: 'Olulimi',
      sw: 'Lugha',
      ach: 'Leb',
    }),
  },
} satisfies Dictionary;

export default localeSwitcherContent;
