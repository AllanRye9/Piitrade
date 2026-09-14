import { t, type Dictionary } from 'intlayer';

const footerContent = {
  key: 'footer',
  content: {
    tagline: t({
      en: 'The premier online marketplace connecting buyers and sellers across',
      lg: 'Akasuubawa akulembeddwa ku yintaneeti egatta abagula n’abatunda mu',
      sw: 'Soko kuu la mtandaoni linalowaunganisha wanunuzi na wauzaji kote',
    }),
    taglineEnd: t({
      en: 'Safe, fast, and free to list.',
      lg: 'Wa bulamu, lwa mangu era lwa bwereere okuwandiikamu.',
      sw: 'Salama, haraka na bila malipo kuweka tangazo.',
    }),
    getSocial: t({ en: 'Get Social', lg: 'Tugoberere ku mikutu', sw: 'Tufuatilie' }),
    company: t({ en: 'Company', lg: 'Kkampuni', sw: 'Kampuni' }),
    support: t({ en: 'Support', lg: 'Obuyambi', sw: 'Msaada' }),
    about: t({ en: 'About Us', lg: 'Akatukwatako', sw: 'Kuhusu Sisi' }),
    advertising: t({ en: 'Advertising', lg: 'Okulanga', sw: 'Matangazo' }),
    blog: t({ en: 'Blog', lg: 'Blogu', sw: 'Blogu' }),
    careers: t({ en: 'Careers', lg: 'Emirimu', sw: 'Kazi' }),
    press: t({ en: 'Press', lg: 'Amawulire', sw: 'Waandishi wa habari' }),
    helpCenter: t({ en: 'Help Center', lg: 'Ekifo ky’obuyambi', sw: 'Kituo cha Msaada' }),
    contactUs: t({ en: 'Contact Us', lg: 'Tukwasagane', sw: 'Wasiliana Nasi' }),
    safetyTips: t({ en: 'Safety Tips', lg: 'Amagezi g’obukuumi', sw: 'Vidokezo vya Usalama' }),
    privacyPolicy: t({ en: 'Privacy Policy', lg: 'Enkola y’obukuumi bw’ebikwata ku muntu', sw: 'Sera ya Faragha' }),
    termsOfService: t({ en: 'Terms of Service', lg: 'Obukwakkulizo bw’okukozesa', sw: 'Masharti ya Huduma' }),
    contact: t({ en: 'Contact', lg: 'Tukwasagane', sw: 'Wasiliana' }),
    aboutShort: t({ en: 'About', lg: 'Akatukwatako', sw: 'Kuhusu' }),
    privacy: t({ en: 'Privacy', lg: 'Obukuumi', sw: 'Faragha' }),
    terms: t({ en: 'Terms', lg: 'Obukwakkulizo', sw: 'Masharti' }),
    allRightsReserved: t({ en: 'All rights reserved.', lg: 'Obuyinza bwonna bukyali bwaffe.', sw: 'Haki zote zimehifadhiwa.' }),
  },
} satisfies Dictionary;

export default footerContent;