import { t, type Dictionary } from "intlayer";

// en, lg (Luganda), and sw (Kiswahili) — the site's three supported
// languages. `en` and `lg` are reviewed; `sw` is a best-effort first pass
// and should still get a native-speaker review before being treated as
// final, same as `lg` was when it was first added.
const localeSwitcherContent = {
  key: "locale-switcher",
  content: {
    ariaLabel: t({
      en: "Select language",
      lg: "Londa olulimi",
      sw: "Chagua lugha",
    }),
    regionLabel: t({
      en: "Language",
      lg: "Olulimi",
      sw: "Lugha",
    }),
  },
} satisfies Dictionary;

export default localeSwitcherContent;
