import { t, type Dictionary } from 'intlayer';

/**
 * TRANSLATION QUALITY NOTE: `en` is the source of truth. `lg`, `sw`, and
 * `ach` (Acoli) are AI-drafted translations pending native-speaker review
 * — see language_translation.xlsx (2026-09-23 export). All keys but
 * `description` carry a draft `ach` value, staged ahead of `ach` being
 * added to `locales` in intlayer.config.ts (not rendered until then).
 * `description` has no usable `ach`: the sheet's only Acoli text for it
 * was a truncated fragment, not the full sentence, so it was left out
 * rather than shipped wrong.
 */
const flashDealsContent = {
  key: 'flash-deals',
  content: {
    heading: t({
      en: 'Flash Deals',
      lg: 'Ebiragiro Ebyanguyirira',
      sw: 'Ofa za Ghafla',
      ach: 'Ofa me piyo',
    }),
    tagline: t({
      en: 'Limited-time drops from our authorized marketplace partners.',
      lg: 'Ebiragiro eby\u2019ekiseera kya kabanga okuva mu bakwatanya baffe abakkirizibwa.',
      sw: 'Ofa za muda mfupi kutoka kwa washirika wetu walioidhinishwa wa soko.',
      ach: 'Limited-time drops ki our authorized soko partners.',
    }),
    description: t({
      en: 'High-demand items from vetted vendors. These independent listings are admin-approved and available only until the timer hits zero.',
      lg: 'Ebintu ebyetagibwa nnyo okuva eri abatunzi abakebeddwa. Ebiwandiikiddwa bino byakkirizibwa omukulembeze era bibaawo okutuusa ekiseera lwe kimalayo.',
      sw: 'Bidhaa zenye mahitaji makubwa kutoka kwa wauzaji waliohakikiwa. Orodha hizi zimeidhinishwa na msimamizi na zinapatikana hadi muda utakapoisha.',
      ach: 'High-demand jami ki vetted vendors. These independent jami ma orumo are ladit-oyubo and tye only until the timer hits zero.',
    }),
    viewAllShort: t({
      en: 'View All',
      lg: 'Laba Byonna',
      sw: 'Ona Zote',
      ach: 'Nen gin mo keken',
    }),
    viewAllLong: t({
      en: 'View All Live Deals',
      lg: 'Laba Ebiragiro Byonna Ebiriwo Kaakati',
      sw: 'Ona Ofa Zote za Sasa',
      ach: 'nen weng Live ofa',
    }),
    hotBadge: t({
      en: 'Hot',
      lg: 'Kya Muliro',
      sw: 'Moto',
      ach: 'Gin ma dong yot',
    }),
    comingSoon: t({
      en: 'Coming soon',
      lg: 'Kijja Mangu',
      sw: 'Inakuja Hivi Karibuni',
      ach: 'Bi piyo',
    }),
  },
} satisfies Dictionary;

export default flashDealsContent;
