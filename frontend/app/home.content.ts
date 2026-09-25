import { t, type Dictionary } from 'intlayer';

/**
 * Homepage section chrome (headings, subtext, CTA labels) for the four
 * sections that were still hardcoded English strings: Flash Deals, Recent
 * Across Categories, Latest Collections, and Featured Deal.
 *
 * TRANSLATION QUALITY NOTE: `en` is the source of truth. `lg`, `sw`, and
 * `ach` (Acoli) are AI-drafted translations pending native-speaker review
 * — see language_translation.xlsx (2026-09-23 export), which supersedes
 * any older per-key claims this comment used to make. All keys but
 * `subtitle` now carry a draft `ach` value, staged ahead of `ach` being
 * added to `locales` in intlayer.config.ts (not rendered until then).
 * `subtitle` has no usable `ach`: the sheet's only Acoli text for it was a
 * truncated fragment, not the full sentence, so it was left out rather
 * than shipped wrong.
 */
const homeContent = {
  key: 'home-page',
  content: {
    recentAcrossCategories: {
      heading: t({
        en: 'Recent Across Categories',
        lg: 'Ebiragajjukiddwa mu Bika Byonna',
        sw: 'Bidhaa Mpya Katika Kategoria Zote',
        ach: 'acel ma oyubo Across kit',
      }),
      subtitle: t({
        en: 'Latest items from key marketplaces \u2014 glance before you browse deeper',
        lg: 'Ebintu ebipya okuva mu maduuka amakulu \u2014 labako nga tonnagenda mu bulungi',
        sw: 'Bidhaa mpya kutoka masoko makuu \u2014 angalia kabla ya kuvinjari zaidi',
        ach: 'Latest jami ki key sokos \u2014 glance makato in yenyo deeper',
      }),
      viewAll: t({
        en: 'View all listings',
        lg: 'Laba byonna ebiwandiikiddwa',
        sw: 'Ona orodha zote',
        ach: 'Nen jami ma ocak weng',
      }),
    },
    latestCollections: {
      heading: t({
        en: 'Latest Collections',
        lg: 'Ebiku\u014b\u014baanyizo Ebipya',
        sw: 'Mikusanyiko Mipya',
        ach: 'Jami ma ocok loyo',
      }),
      subtitle: t({
        en: 'Latest curated items',
        lg: 'Ebintu ebipya ebyalondebwa',
        sw: 'Bidhaa mpya zilizoteuliwa',
        ach: 'Latest curated jami',
      }),
      viewAll: t({
        en: 'View all',
        lg: 'Laba byonna',
        sw: 'Ona zote',
        ach: 'Nen jami weng',
      }),
      visit: t({
        en: 'Visit',
        lg: 'Kyalira',
        sw: 'Tembelea',
        ach: 'Visit',
      }),
    },
    featuredDeal: {
      heading: t({
        en: 'Featured Deal',
        lg: 'Ekiragiro Ekyerondeddwa',
        sw: 'Ofa Maalum',
        ach: 'Gin ma ber ma ayera',
      }),
      handpickedBadge: t({
        en: 'Handpicked for you',
        lg: 'Kyakulondeddwa ggwe',
        sw: 'Imechaguliwa kwa ajili yako',
        ach: 'Oyere pi in',
      }),
      subtitle: t({
        en: 'Our premier choice for today. Standout items selected by our experts for exceptional quality and value.',
        lg: 'Okulonda kwaffe okusinga leero. Ebintu ebisinga ebirondeddwa abakugu baffe olw\u2019omutindo n\u2019omuwendo omulungi.',
        sw: 'Chaguo letu bora la leo. Bidhaa bora zilizochaguliwa na wataalamu wetu kwa ubora na thamani ya kipekee.',
        ach: 'Our premier choice for today. Standout jami yered by our experts for exceptional quality and value.',
      }),
      viewAllDeals: t({
        en: 'View all deals',
        lg: 'Laba ebiragiro byonna',
        sw: 'Ona ofa zote',
        ach: 'nen weng ofa',
      }),
    },
  },
} satisfies Dictionary;

export default homeContent;
