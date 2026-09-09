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
// Custom locale code (lg) isn't in intlayer's built-in `Locale` union — it's
// a plain string-literal union, not an interface, so it can't be extended
// via module augmentation. `strict: false` below only relaxes runtime
// validation, not this compile-time list, so the cast is required for
// `next build`'s type-check step to pass. Intlayer itself treats any string
// as a valid locale at runtime.
//
// Scope: en is the default. lg (Luganda) and sw (Kiswahili) are the two
// translated languages. The previous ach/nyn/lam/teo locales were removed —
// they only ever had unverified AI placeholder text (see git history), so
// keeping them live risked shipping wrong translations under a real
// language's name. Add them back once genuine content exists for them.
const locales = [
  "en",       // English (Default)
  "lg",       // Luganda
  "sw",       // Kiswahili
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
