import { t, type Dictionary } from 'intlayer';

/**
 * TRANSLATION QUALITY NOTE: `en` is the source of truth. `lg` and `sw` are
 * AI best-effort translations — review with a native speaker before
 * treating as final.
 */
const flashDealsContent = {
  key: 'flash-deals',
  content: {
    heading: t({
      en: 'Flash Deals',
      lg: 'Ebiragiro Ebyanguyirira',
      sw: 'Ofa za Ghafla',
    }),
    tagline: t({
      en: 'Limited-time drops from our authorized marketplace partners.',
      lg: 'Ebiragiro eby\u2019ekiseera kya kabanga okuva mu bakwatanya baffe abakkirizibwa.',
      sw: 'Ofa za muda mfupi kutoka kwa washirika wetu walioidhinishwa wa soko.',
    }),
    description: t({
      en: 'High-demand items from vetted vendors. These independent listings are admin-approved and available only until the timer hits zero.',
      lg: 'Ebintu ebyetagibwa nnyo okuva eri abatunzi abakebeddwa. Ebiwandiikiddwa bino byakkirizibwa omukulembeze era bibaawo okutuusa ekiseera lwe kimalayo.',
      sw: 'Bidhaa zenye mahitaji makubwa kutoka kwa wauzaji waliohakikiwa. Orodha hizi zimeidhinishwa na msimamizi na zinapatikana hadi muda utakapoisha.',
    }),
    viewAllShort: t({
      en: 'View All',
      lg: 'Laba Byonna',
      sw: 'Ona Zote',
    }),
    viewAllLong: t({
      en: 'View All Live Deals',
      lg: 'Laba Ebiragiro Byonna Ebiriwo Kaakati',
      sw: 'Ona Ofa Zote za Sasa',
    }),
    hotBadge: t({
      en: 'Hot',
      lg: 'Kya Muliro',
      sw: 'Moto',
    }),
    comingSoon: t({
      en: 'Coming soon',
      lg: 'Kijja Mangu',
      sw: 'Inakuja Hivi Karibuni',
    }),
  },
} satisfies Dictionary;

export default flashDealsContent;
