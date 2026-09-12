import "intlayer";
import _2fjbqt1eqpk from './flash-deals.ts';
import _1vslkggce73 from './home-page.ts';
import _1sv9598mb9v from './locale-switcher.ts';
import _ah39du02q5 from './mobileBottomNav.ts';

declare module 'intlayer' {
  interface __DictionaryRegistry {
    "flash-deals": typeof _2fjbqt1eqpk;
    "home-page": typeof _1vslkggce73;
    "locale-switcher": typeof _1sv9598mb9v;
    "mobileBottomNav": typeof _ah39du02q5;
  }

  interface __DeclaredLocalesRegistry {
    "en": 1;
    "lg": 1;
    "sw": 1;
  }

  interface __RequiredLocalesRegistry {
    "en": 1;
    "lg": 1;
    "sw": 1;
  }

  interface __SchemaRegistry {

  }

  interface __StrictModeRegistry { mode: 'loose' }

  interface __EditorRegistry { enabled : false }

  interface __RoutingRegistry { mode: 'no-prefix'; defaultLocale: 'en' }
}
