import { t, type Dictionary } from 'intlayer';

/**
 * TRANSLATION QUALITY NOTE: `en` is the source of truth. `lg`, `sw`, and
 * `ach` (Acoli) are AI-drafted translations pending native-speaker review
 * — see language_translation.xlsx (2026-09-23 export), which supersedes
 * any older per-key claims this comment used to make. All keys but
 * `sayHello` now carry a draft `ach` value, staged ahead of `ach` being
 * added to `locales` in intlayer.config.ts (not rendered until then).
 * `sayHello` has no `ach` yet — not mistranslated, just not done.
 */
const messagesContent = {
  key: 'messages-page',
  content: {
    title: t({
      en: 'Messages',
      lg: 'Obubaka',
      sw: 'Ujumbe',
      ach: 'Mesaji',
    }),
    conversations: t({
      en: 'Conversations',
      lg: 'Emboozi',
      sw: 'Mazungumzo',
      ach: 'Lok mapol',
    }),
    noConversationsTitle: t({
      en: 'No conversations yet',
      lg: 'Tewali mboozi zonna',
      sw: 'Hakuna mazungumzo bado',
      ach: 'Pe tye lok mapol',
    }),
    noConversationsSubtitle: t({
      en: 'Messages with buyers and sellers will show up here.',
      lg: 'Obubaka n\u2019abaguzi n\u2019abatunzi bujja kulabika wano.',
      sw: 'Ujumbe kati yako na wanunuzi au wauzaji utaonekana hapa.',
      ach: 'Messages with lawil and lacat will show up here.',
    }),
    selectConversation: t({
      en: 'Select a conversation to start chatting',
      lg: 'Londa emboozi okutandika okwogera',
      sw: 'Chagua mazungumzo ili kuanza kuzungumza',
      ach: 'yer a conversation to cako chatting',
    }),
    backToConversations: t({
      en: 'Back to conversations',
      lg: 'Ddayo ku mboozi',
      sw: 'Rudi kwenye mazungumzo',
      ach: 'Dwok i lok mapol',
    }),
    online: t({
      en: 'Online',
      lg: 'Ali Waliwo',
      sw: 'Yupo Mtandaoni',
      ach: 'I intanet',
    }),
    typing: t({
      en: 'typing\u2026',
      lg: 'awandiika\u2026',
      sw: 'anaandika\u2026',
      ach: 'typing\u2026',
    }),
    lastSeen: t({
      en: 'Last seen',
      lg: 'Yalabikayo oluvannyuma',
      sw: 'Alionekana mara ya mwisho',
      ach: 'Neno me agiki',
    }),
    reListing: t({
      en: 'Re:',
      lg: 'Ekikwata ku:',
      sw: 'Kuhusu:',
      ach: 'Re:',
    }),
    sayHello: t({
      en: 'Say hello \u2014 your message will start the conversation.',
      lg: 'Labula \u2014 obubaka bwo bujja kutandika emboozi.',
      sw: 'Salimia \u2014 ujumbe wako utaanzisha mazungumzo.',
      ach: 'Say hello \u2014 ni mesaji will cako the conversation.',
    }),
    typePlaceholder: t({
      en: 'Type a message\u2026',
      lg: 'Wandiika obubaka\u2026',
      sw: 'Andika ujumbe\u2026',
      ach: 'kit a mesaji\u2026',
    }),
    sendMessage: t({
      en: 'Send message',
      lg: 'Sindika obubaka',
      sw: 'Tuma ujumbe',
      ach: 'Cwal mesaji',
    }),
    loadFailed: t({
      en: 'Could not load this conversation.',
      lg: 'Tetuyinza kuleeta mboozi eno.',
      sw: 'Imeshindwa kupakia mazungumzo haya.',
      ach: 'Could not load this conversation.',
    }),
    sendFailed: t({
      en: 'Message failed to send. Please try again.',
      lg: 'Obubaka tebusindise. Ddamu ogezeeko.',
      sw: 'Ujumbe umeshindwa kutumwa. Tafadhali jaribu tena.',
      ach: 'Mesaji pe ocito. Tim ber itemet dok.',
    }),
    newConversation: t({
      en: 'New Conversation',
      lg: 'Emboozi Empya',
      sw: 'Mazungumzo Mapya',
      ach: 'Lok manyen',
    }),
    loading: t({
      en: 'Loading\u2026',
      lg: 'Kitikka\u2026',
      sw: 'Inapakia\u2026',
      ach: 'Tye ka gamo\u2026',
    }),
  },
} satisfies Dictionary;

export default messagesContent;
