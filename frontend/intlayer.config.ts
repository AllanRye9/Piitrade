import type { IntlayerConfig } from "intlayer";
import type { Locale } from "@intlayer/types";

// NOTE: this mirrors the intlayer.config.ts at the repo root. It has to live
// here too (not just at the root) because the frontend is built from its own
// Docker context (`frontend/Dockerfile`, build context `./frontend` — see
// docker-compose.yml / railway.json), which never includes the repo root.
// Next.js — and the `withIntlayer` plugin in next.config.mjs — resolve this
// file relative to the frontend project root, so this is the copy that
// actually governs the running app. Keep the two in sync if locales change.
//
// Custom locale codes (lg, ach) aren't in intlayer's built-in `Locale` union
// — it's a plain string-literal union, not an interface, so it can't be
// extended via module augmentation. `strictMode: "loose"` below only relaxes
// runtime validation, not this compile-time list, so the cast is required
// for `next build`'s type-check step to pass. Intlayer itself treats any
// string as a valid locale at runtime.
//
// Scope: en is the default. lg (Luganda), sw (Kiswahili) and ach (Acoli) are
// the three active translated languages. nyn/lam/teo remain removed — they
// only ever had unverified AI placeholder text (see git history), so keeping
// them live risked shipping wrong translations under a real language's
// name. Add a locale back once genuine content exists for it across the
// site.
//
// ach (Acoli) activated 2026-09-24: every key across the site's 7
// currently-registered content files (home.content.ts,
// createProduce.content.ts, messages.content.ts, MobileBottomNav.content.ts,
// localeSwitcher.content.ts, contactSellerModal.content.ts,
// flashDeals.content.ts) now carries an `ach:` value — either a genuine
// draft translation sourced from language_translation.xlsx (2026-09-24
// export), or, for the handful of keys added after that sheet was generated
// with no sourced Acoli text yet (createProduce.content.ts: priceUnitLabel,
// unitPerItem, unitPerKg, unitPerTonne), the literal English string used as
// an intentional fallback rather than an invented translation. Those four
// are flagged with an inline comment at their declaration and should be
// replaced with genuine Acoli text once it's available — doing so is a
// content-only change, no code or config change needed.
//
// TRANSLATION QUALITY NOTE (applies to lg/sw/ach across every content file):
// `en` is the source of truth. `lg`, `sw`, and `ach` are AI-drafted
// translations pending native-speaker review.
const locales = [
  "en",       // English (Default)
  "lg",       // Luganda
  "sw",       // Kiswahili
  "ach",      // Acoli
] as unknown as Locale[];

const config: IntlayerConfig = {
  internationalization: {
    // Define your supported languages using standard tags
    locales,
    defaultLocale: "en",
    // "loose" is the current schema's equivalent of the old boolean
    // `strict: false` intent: the `t` function accepts any existing locale
    // instead of requiring every declared locale to be defined (as "strict"
    // and "inclusive" both do). "strict"/"strict: false" is not a valid
    // property on this version of the config type.
    //
    // Runtime fallback: Intlayer's own dictionary resolution falls back to
    // `defaultLocale` (en) whenever a rendered key has no value at all for
    // the active locale, so any key that is ever left without an `ach`
    // value in the future renders in English rather than empty/broken —
    // it just also has to satisfy the dictionary type-check described
    // above before `next build` will accept it (see the ach activation
    // note: fill it with a genuine translation, or the literal English
    // string as an explicit placeholder, never leave it unset).
    strictMode: "loose",
  },
  routing: {
    // The app currently has ~40 top-level route folders under app/ with no
    // [locale] segment, and existing links/SEO/sitemap.ts all assume
    // unprefixed paths. `no-prefix` keeps every route exactly where it is —
    // the locale is resolved from a cookie / Accept-Language header instead
    // of the URL — so this integrates without restructuring app/ or
    // touching sitemap.ts, robots.ts, or existing internal links.
    mode: "no-prefix",
  },
};

export default config;
