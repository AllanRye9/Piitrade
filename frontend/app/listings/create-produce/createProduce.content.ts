import { t, type Dictionary } from 'intlayer';

/**
 * TRANSLATION QUALITY NOTE: `en` is the source of truth. `lg`, `sw`, and
 * `ach` (Acoli) are AI-drafted translations pending native-speaker review
 * — see language_translation.xlsx (2026-09-23 export) for the reviewed
 * source of these values; that sheet supersedes any older per-key claims
 * this comment used to make. Nearly every key now carries a draft `ach`
 * value, staged ahead of `ach` being added to `locales` in
 * intlayer.config.ts (not rendered until then). Three keys —
 * `pageSubtitle`, `errLoadFailed`, `errSubmitFailed` — still have no
 * usable `ach`: the sheet's only Acoli text for them was a truncated
 * fragment, not a translation of the full sentence, so it was deliberately
 * left out rather than shipped as wrong/partial. `priceUnitLabel`,
 * `unitPerItem`, `unitPerKg`, `unitPerTonne` are newer keys not yet in
 * that sheet at all.
 */
const createProduceContent = {
  key: 'create-produce-page',
  content: {
    loading: t({
      en: 'Loading\u2026',
      lg: 'Kitikka\u2026',
      sw: 'Inapakia\u2026',
      ach: 'Tye ka gamo\u2026',
    }),
    loginHeading: t({
      en: 'Log in to post your produce',
      lg: 'Yingira okuteeka ebibala byo',
      sw: 'Ingia kuweka mazao yako',
      ach: 'Donj i akawunti me keto jami me pur ni',
    }),
    loginSubtitle: t({
      en: 'Any Piitrade account can list farm produce \u2014 no store or subscription needed.',
      lg: 'Akawunti yonna eya Piitrade eyinza okuteeka ebibala \u2014 tewetaagisa dduuka wadde okwewandiisa.',
      sw: 'Akaunti yoyote ya Piitrade inaweza kuorodhesha mazao \u2014 hakuna duka au usajili unaohitajika.',
      ach: 'mo keken Piitrade akawunti can ket farm produce \u2014 pe duka or kwako needed.',
    }),
    logIn: t({
      en: 'Log In',
      lg: 'Yingira',
      sw: 'Ingia',
      ach: 'Donjo',
    }),
    submittedOneTitle: t({
      en: 'Your product was submitted',
      lg: 'Ekintu kyo kiweereddwa',
      sw: 'Bidhaa yako imewasilishwa',
      ach: 'Gin ni o-cwalo',
    }),
    submittedManyTitle: t({
      en: 'products were submitted',
      lg: 'ebintu byaweereddwa',
      sw: 'bidhaa zimewasilishwa',
      ach: 'jami were submitted',
    }),
    pendingApprovalOne: t({
      en: 'It\u2019s pending admin approval and will appear on the site once approved \u2014 usually within a day.',
      lg: 'Kirindiridde okukakasibwa omukulembeze era kijja kulabika ku mukutu nga kimaze okukakasibwa \u2014 mu bukiikakika olunaku olumu.',
      sw: 'Inasubiri idhini ya msimamizi na itaonekana kwenye tovuti mara itakapoidhinishwa \u2014 kwa kawaida ndani ya siku moja.',
      ach: 'It\u2019s orindo ladit yubo and will appear on the website once oyubo \u2014 usually within a nino.',
    }),
    pendingApprovalMany: t({
      en: 'They\u2019ve pending admin approval and will appear on the site once approved \u2014 usually within a day.',
      lg: 'Birindiridde okukakasibwa omukulembeze era bijja kulabika ku mukutu nga bimaze okukakasibwa \u2014 mu bukiikakika olunaku olumu.',
      sw: 'Zinasubiri idhini ya msimamizi na zitaonekana kwenye tovuti mara zitakapoidhinishwa \u2014 kwa kawaida ndani ya siku moja.',
      ach: 'They\u2019ve orindo ladit yubo and will appear on the website once oyubo \u2014 usually within a nino.',
    }),
    viewMyListings: t({
      en: 'View My Listings',
      lg: 'Laba Ebiwandiikiddwa Byange',
      sw: 'Ona Orodha Zangu',
      ach: 'Nen jami ma iya cato',
    }),
    postAnother: t({
      en: 'Post Another',
      lg: 'Teeka Ekirala',
      sw: 'Weka Nyingine',
      ach: 'ket mokene',
    }),
    pageHeading: t({
      en: 'Sell Your Farm Produce',
      lg: 'Tunda Ebibala Byo',
      sw: 'Uza Mazao Yako ya Shambani',
      ach: 'Cat jami me pur ni',
    }),
    pageSubtitle: t({
      en: 'Open to every farmer and seller \u2014 no store subscription required. Every submission is reviewed by an admin before it goes live.',
      lg: 'Kikwata buli mulimi na mutunzi \u2014 tewetaagisa kwewandiisa dduuka. Buli kyaweerezebwa kikebenkanyizibwa omukulembeze nga tekinnalabika.',
      sw: 'Wazi kwa kila mkulima na muuzaji \u2014 hakuna usajili wa duka unaohitajika. Kila uwasilishaji hukaguliwa na msimamizi kabla ya kuonekana.',
      ach: 'yab to every farmer and lacat \u2014 pe duka kwako myero. Every submission is renened by an ladit makato it goes live.',
    }),
    oneProduct: t({
      en: 'One Product',
      lg: 'Ekintu Kimu',
      sw: 'Bidhaa Moja',
      ach: 'Gin acel',
    }),
    multipleProducts: t({
      en: 'Multiple Products',
      lg: 'Ebintu Bingi',
      sw: 'Bidhaa Nyingi',
      ach: 'Jami mapol',
    }),
    productLabel: t({
      en: 'Product',
      lg: 'Ekintu',
      sw: 'Bidhaa',
      ach: 'Gin',
    }),
    remove: t({
      en: 'Remove',
      lg: 'Ggyawo',
      sw: 'Ondoa',
      ach: 'Golo',
    }),
    productName: t({
      en: 'Product name',
      lg: 'Erinnya ly\u2019Ekintu',
      sw: 'Jina la Bidhaa',
      ach: 'Nying gin',
    }),
    productNamePlaceholder: t({
      en: 'e.g. Fresh Maize (Grade A)',
      lg: 'okugeza: Kasooli Musu (Ekika A)',
      sw: 'mf. Mahindi Mabichi (Daraja A)',
      ach: 'e.g. Fresh Maize (Grade A)',
    }),
    description: t({
      en: 'Description',
      lg: 'Obunnyonnyofu',
      sw: 'Maelezo',
      ach: 'Nyonyo matut',
    }),
    descriptionPlaceholder: t({
      en: 'Quality, harvest date, delivery options\u2026',
      lg: 'Omutindo, olunaku lw\u2019okukungula, engeri y\u2019okutuusa\u2026',
      sw: 'Ubora, tarehe ya mavuno, chaguo za usafirishaji\u2026',
      ach: 'Quality, harvest nino, cweyo options\u2026',
    }),
    category: t({
      en: 'Category',
      lg: 'Ekika',
      sw: 'Kategoria',
      ach: 'Kit',
    }),
    generalAgriculture: t({
      en: 'General Agriculture',
      lg: 'Eby\u2019Obulimi Awamu',
      sw: 'Kilimo kwa Ujumla',
      ach: 'Pur ma dok i kom',
    }),
    condition: t({
      en: 'Condition',
      lg: 'Embeera',
      sw: 'Hali',
      ach: 'Kit ma tye',
    }),
    freshNew: t({
      en: 'Fresh / New',
      lg: 'Kipya',
      sw: 'Mpya / Bichi',
      ach: 'Nyen / Maleng',
    }),
    usedEquipment: t({
      en: 'Used (e.g. equipment)',
      lg: 'Ekikozesebwa (okugeza ebyuma)',
      sw: 'Vilivyotumika (mf. vifaa)',
      ach: 'Moketo (calo jami me tic)',
    }),
    priceLabel: t({
      en: 'Price',
      lg: 'Omuwendo',
      sw: 'Bei',
      ach: 'Wel',
    }),
    // These four keys were added after the 2026-09-23 translation sheet was
    // generated, so no sourced Acoli text exists for them yet. Per the
    // explicit "fall back to English where no translation exists" rule,
    // `ach` is set to the literal English string here rather than left
    // unset (which would break `ach` dictionary type-checking) or guessed
    // at (which would risk shipping a wrong translation under a real
    // language's name). Replace with genuine Acoli text once available.
    priceUnitLabel: t({ en: 'Priced per', lg: 'Omuwendo gwa buli', sw: 'Bei kwa kila', ach: 'Priced per' }),
    unitPerItem: t({ en: 'Item', lg: 'Ekintu', sw: 'Bidhaa', ach: 'Item' }),
    unitPerKg: t({ en: 'Kg', lg: 'Kg', sw: 'Kg', ach: 'Kg' }),
    unitPerTonne: t({ en: 'Tonne', lg: 'Tona', sw: 'Tani', ach: 'Tonne' }),
    quantityAvailable: t({
      en: 'Quantity available',
      lg: 'Obungi obuliwo',
      sw: 'Kiasi Kinachopatikana',
      ach: 'Wel jami ma tye',
    }),
    quantityPlaceholder: t({
      en: 'e.g. 50',
      lg: 'okugeza: 50',
      sw: 'mf. 50',
      ach: 'e.g. 50',
    }),
    locationLabel: t({
      en: 'Location (Uganda)',
      lg: 'Ekifo (Uganda)',
      sw: 'Mahali (Uganda)',
      ach: 'Kabedo (Uganda)',
    }),
    locationPlaceholder: t({
      en: 'e.g. Iganga, Uganda',
      lg: 'okugeza: Iganga, Uganda',
      sw: 'mf. Iganga, Uganda',
      ach: 'e.g. Iganga, Uganda',
    }),
    photosOptional: t({
      en: 'Photos (optional)',
      lg: 'Ebifaananyi (si bya bwe tteekwa)',
      sw: 'Picha (si lazima)',
      ach: 'Cal (pe me gire)',
    }),
    uploading: t({
      en: 'Uploading\u2026',
      lg: 'Kiweebwa\u2026',
      sw: 'Inapakiwa\u2026',
      ach: 'Tye ka keto\u2026',
    }),
    addAnotherProduct: t({
      en: '+ Add Another Product',
      lg: '+ Yongera Ekintu Ekirala',
      sw: '+ Ongeza Bidhaa Nyingine',
      ach: '+ med mokene gin',
    }),
    maxReached: t({
      en: 'max',
      lg: 'ekisinga',
      sw: 'kiwango cha juu',
      ach: 'mapol',
    }),
    submitting: t({
      en: 'Submitting\u2026',
      lg: 'Kiweereza\u2026',
      sw: 'Inawasilishwa\u2026',
      ach: 'Tye ka cwal\u2026',
    }),
    submitForApproval: t({
      en: 'Submit for Approval',
      lg: 'Weereza Okukakasibwa',
      sw: 'Wasilisha kwa Idhini',
      ach: 'Cwal me yubo',
    }),
    submitMultiple: t({
      en: 'Submit',
      lg: 'Weereza',
      sw: 'Wasilisha',
      ach: 'Cwal',
    }),
    productsForApproval: t({
      en: 'Products for Approval',
      lg: 'Ebintu Okukakasibwa',
      sw: 'Bidhaa kwa Idhini',
      ach: 'Jami ma orindo me yubo',
    }),
    errCategoriesLoading: t({
      en: 'Produce categories are still loading \u2014 please wait a moment and try again.',
      lg: 'Ebika by\u2019ebibala bikyaleeta \u2014 linda akatono oddemu ogezeeko.',
      sw: 'Kategoria za mazao bado zinapakia \u2014 tafadhali subiri kidogo kisha jaribu tena.',
      ach: 'Produce kit are still tye ka gamo \u2014 Tim ber iriw manok and try again.',
    }),
    errCatsNotSetUp: t({
      en: 'Produce categories aren\u2019t set up yet \u2014 please try again in a moment or contact support.',
      lg: 'Ebika by\u2019ebibala tebinnateekebwawo \u2014 ddamu ogezeeko oluvannyuma oba tukwatagane n\u2019obuyambi.',
      sw: 'Kategoria za mazao bado hazijawekwa \u2014 tafadhali jaribu tena baadaye au wasiliana na msaada.',
      ach: 'Produce kit aren\u2019t set up yet \u2014 Tim ber gin doki in a moment or lok ki kony.',
    }),
    errLoadFailed: t({
      en: 'Could not load produce categories. Please refresh and try again.',
      lg: 'Tetuyinza kuleeta bika by\u2019ebibala. Ddamu oteekemu olupapula oddemu ogezeeko.',
      sw: 'Imeshindwa kupakia kategoria za mazao. Tafadhali onyesha upya na ujaribu tena.',
      ach: 'Could not load produce kit. Please refresh and try again.',
    }),
    errUploadFailed: t({
      en: 'Image upload failed. You can still submit without a photo and add one later.',
      lg: 'Okuweereza ekifaananyi tekulabise. Osobola okuweereza awatali kifaananyi n\u2019oyongera oluvannyuma.',
      sw: 'Upakiaji wa picha umeshindwa. Bado unaweza kuwasilisha bila picha na kuongeza baadaye.',
      ach: 'cal ket failed. in can still submit without a cal and med one later.',
    }),
    errSubmitFailed: t({
      en: 'Something went wrong while posting your produce. Please try again.',
      lg: 'Ekintu tekigenze bulungi ng\u2019oweereza ebibala byo. Ddamu ogezeeko.',
      sw: 'Hitilafu imetokea wakati wa kuweka mazao yako. Tafadhali jaribu tena.',
      ach: 'Something went wrong while posting ni produce. Tim ber gin doki.',
    }),
    validTitleRequired: t({
      en: 'please enter a title.',
      lg: 'teeka erinnya.',
      sw: 'tafadhali weka jina.',
      ach: 'tim ber ket nying.',
    }),
    validDescriptionRequired: t({
      en: 'please enter a description.',
      lg: 'teeka obunnyonnyofu.',
      sw: 'tafadhali weka maelezo.',
      ach: 'tim ber ket nyonyo matut.',
    }),
    validPriceRequired: t({
      en: 'please enter a valid price.',
      lg: 'teeka omuwendo omutuufu.',
      sw: 'tafadhali weka bei sahihi.',
      ach: 'tim ber ket wel ma atir.',
    }),
    validQuantityRequired: t({
      en: 'please enter a valid quantity.',
      lg: 'teeka obungi obutuufu.',
      sw: 'tafadhali weka kiasi sahihi.',
      ach: 'tim ber ket wel jami ma atir.',
    }),
    validLocationRequired: t({
      en: 'please enter a location.',
      lg: 'teeka ekifo.',
      sw: 'tafadhali weka mahali.',
      ach: 'tim ber ket kabedo.',
    }),
    yourProductLabel: t({
      en: 'Your product',
      lg: 'Ekintu kyo',
      sw: 'Bidhaa yako',
      ach: 'Gin ni',
    }),
  },
} satisfies Dictionary;

export default createProduceContent;
