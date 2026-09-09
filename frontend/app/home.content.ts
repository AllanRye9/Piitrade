import { t, type Dictionary } from 'intlayer';

/**
 * Homepage section chrome (headings, subtext, CTA labels) for the four
 * sections that were still hardcoded English strings: Flash Deals, Recent
 * Across Categories, Latest Collections, and Featured Deal.
 *
 * TRANSLATION QUALITY NOTE: `en` is the source of truth. `lg` (Luganda) and
 * `sw` (Kiswahili) are AI best-effort translations and should get a native
 * speaker review before being treated as final — same caveat as the rest
 * of the site's non-English content.
 */
const homeContent = {
  key: 'home-page',
  content: {
    recentAcrossCategories: {
      heading: t({
        en: 'Recent Across Categories',
        lg: 'Ebiragajjukiddwa mu Bika Byonna',
        sw: 'Bidhaa Mpya Katika Kategoria Zote',
      }),
      subtitle: t({
        en: 'Latest items from key marketplaces — glance before you browse deeper',
        lg: 'Ebintu ebipya okuva mu maduuka amakulu — labako nga tonnagenda mu bulungi',
        sw: 'Bidhaa mpya kutoka masoko makuu — angalia kabla ya kuvinjari zaidi',
      }),
      viewAll: t({
        en: 'View all listings',
        lg: 'Laba byonna ebiwandiikiddwa',
        sw: 'Ona orodha zote',
      }),
    },
    latestCollections: {
      heading: t({
        en: 'Latest Collections',
        lg: 'Ebikuŋŋaanyizo Ebipya',
        sw: 'Mikusanyiko Mipya',
      }),
      subtitle: t({
        en: 'Latest curated items',
        lg: 'Ebintu ebipya ebyalondebwa',
        sw: 'Bidhaa mpya zilizoteuliwa',
      }),
      viewAll: t({
        en: 'View all',
        lg: 'Laba byonna',
        sw: 'Ona zote',
      }),
      visit: t({
        en: 'Visit',
        lg: 'Kyalira',
        sw: 'Tembelea',
      }),
    },
    featuredDeal: {
      heading: t({
        en: 'Featured Deal',
        lg: 'Ekiragiro Ekyerondeddwa',
        sw: 'Ofa Maalum',
      }),
      handpickedBadge: t({
        en: 'Handpicked for you',
        lg: 'Kyakulondeddwa ggwe',
        sw: 'Imechaguliwa kwa ajili yako',
      }),
      subtitle: t({
        en: 'Our premier choice for today. Standout items selected by our experts for exceptional quality and value.',
        lg: 'Okulonda kwaffe okusinga leero. Ebintu ebisinga ebirondeddwa abakugu baffe olw\u2019omutindo n\u2019omuwendo omulungi.',
        sw: 'Chaguo letu bora la leo. Bidhaa bora zilizochaguliwa na wataalamu wetu kwa ubora na thamani ya kipekee.',
      }),
      viewAllDeals: t({
        en: 'View all deals',
        lg: 'Laba ebiragiro byonna',
        sw: 'Ona ofa zote',
      }),
    },
  },
} satisfies Dictionary;

export default homeContent;
