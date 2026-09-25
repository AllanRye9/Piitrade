import { t, type Dictionary } from 'intlayer';

/**
 * TRANSLATION QUALITY NOTE: `en` is the source of truth. `lg`, `sw`, and
 * `ach` (Acoli) are AI-drafted translations pending native-speaker review
 * — see language_translation.xlsx (2026-09-23 export). All keys but
 * `defaultSubheading`, `noPhoneOnFile`, `someItemsSubheading`, and
 * `orderNotSoldSubheading` carry a draft `ach` value, staged ahead of
 * `ach` being added to `locales` in intlayer.config.ts (not rendered
 * until then). Those four have no `ach` yet — not mistranslated, just
 * not done.
 */
const contactSellerContent = {
  key: 'contact-seller-modal',
  content: {
    defaultHeading: t({
      en: 'Contact the Seller',
      lg: 'Tukwatagane n\u2019Omutunzi',
      sw: 'Wasiliana na Muuzaji',
      ach: 'Lok ki lacat',
    }),
    defaultSubheading: t({
      en: 'Piitrade puts you in touch directly \u2014 arrange payment and pickup or delivery with the seller.',
      lg: 'Piitrade ekugatta butereevu n\u2019omutunzi \u2014 mwesalize ku nsimbi n\u2019okutwala ebintu.',
      sw: 'Piitrade inakuunganisha moja kwa moja na muuzaji \u2014 panga malipo na uchukuzi au usafirishaji.',
      ach: 'Piitrade puts in in touch directly \u2014 arrange pay and pickup or cweyo with the lacat.',
    }),
    close: t({
      en: 'Close',
      lg: 'Ggalawo',
      sw: 'Funga',
      ach: 'Cung',
    }),
    noPhoneOnFile: t({
      en: 'No phone number on file \u2014 message them on Piitrade instead.',
      lg: 'Tewali namba ya ssimu \u2014 mubatumire obubaka ku Piitrade.',
      sw: 'Hakuna namba ya simu \u2014 mtumie ujumbe kwenye Piitrade badala yake.',
      ach: 'pe phone namba on fayilo \u2014 mesaji them on Piitrade instead.',
    }),
    messageOnPiitrade: t({
      en: 'Message on Piitrade',
      lg: 'Tumira Obubaka ku Piitrade',
      sw: 'Tuma Ujumbe kwenye Piitrade',
      ach: 'mesaji on Piitrade',
    }),
    callSeller: t({
      en: 'Call Seller',
      lg: 'Kuba Omutunzi',
      sw: 'Piga Simu Muuzaji',
      ach: 'Lwong lacat',
    }),
    chatOnWhatsapp: t({
      en: 'Chat on WhatsApp',
      lg: 'Yogera ku WhatsApp',
      sw: 'Ongea kwenye WhatsApp',
      ach: 'Lok i WhatsApp',
    }),
    contactYourSellers: t({
      en: 'Contact Your Sellers',
      lg: 'Tukwatagane n\u2019Abatunzi Bo',
      sw: 'Wasiliana na Wauzaji Wako',
      ach: 'lok ni lacat',
    }),
    mixedCartSubheading: t({
      en: 'Online checkout only covers items sold directly by Piitrade. The rest of your cart needs direct contact with these sellers instead.',
      lg: 'Okusasula ku yintaneeti kukwata byokka ebitundibwa Piitrade butereevu. Ebirala mu kikapu kyo byetaaga mutukwatagane n\u2019abatunzi bano.',
      sw: 'Malipo mtandaoni yanahusu tu bidhaa zinazouzwa moja kwa moja na Piitrade. Bidhaa nyingine kwenye kikapu chako zinahitaji kuwasiliana moja kwa moja na wauzaji hawa.',
      ach: 'i intanet checkout only covers jami ocato directly by Piitrade. The rest of ni kibbo needs direct lok with these lacat instead.',
    }),
    completeOrderHeading: t({
      en: 'Contact the Seller to Complete Your Order',
      lg: 'Tukwatagane n\u2019Omutunzi Okumaliriza Okuweereza Kwo',
      sw: 'Wasiliana na Muuzaji Kukamilisha Agizo Lako',
      ach: 'lok the lacat to tyeko ni oda',
    }),
    someItemsSubheading: t({
      en: 'Some items in your cart aren\u2019t sold directly by Piitrade, so online checkout isn\u2019t available for them \u2014 arrange payment and delivery directly with these sellers instead.',
      lg: 'Ebimu ku bintu mu kikapu kyo tebitundibwa Piitrade butereevu, waaba okusasula ku yintaneeti tekukyayinzika \u2014 mwesalize butereevu n\u2019abatunzi bano.',
      sw: 'Baadhi ya bidhaa kwenye kikapu chako hazizouzwi moja kwa moja na Piitrade, hivyo malipo mtandaoni hayapatikani kwa hizo \u2014 panga malipo na usafirishaji moja kwa moja na wauzaji hawa.',
      ach: 'Some jami in ni kibbo aren\u2019t ocato directly by Piitrade, so i intanet checkout isn\u2019t tye for them \u2014 arrange pay and cweyo directly with these lacat instead.',
    }),
    orderNotSoldSubheading: t({
      en: 'This order isn\u2019t sold directly by Piitrade, so online checkout isn\u2019t available \u2014 arrange payment and delivery directly with the seller instead.',
      lg: 'Ekiragiro kino tekitundibwa Piitrade butereevu, waaba okusasula ku yintaneeti tekukyayinzika \u2014 mwesalize butereevu n\u2019omutunzi.',
      sw: 'Agizo hili halziuzwi moja kwa moja na Piitrade, hivyo malipo mtandaoni hayapatikani \u2014 panga malipo na usafirishaji moja kwa moja na muuzaji.',
      ach: 'This oda isn\u2019t ocato directly by Piitrade, so i intanet checkout isn\u2019t tye \u2014 arrange pay and cweyo directly with the lacat instead.',
    }),
    browseListings: t({
      en: 'Browse Listings',
      lg: 'Noonya Ebiwandiikiddwa',
      sw: 'Vinjari Orodha',
      ach: 'Yenyo jami ma ocako',
    }),
  },
} satisfies Dictionary;

export default contactSellerContent;
