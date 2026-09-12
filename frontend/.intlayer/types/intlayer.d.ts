import "intlayer";
import _kvn7m6mlza from './flash-deals.ts';
import _yctx0wccf8 from './home-page.ts';
import _2fhxby7fg24 from './locale-switcher.ts';
import _kiu1rn7miq from './mobileBottomNav.ts';

declare module 'intlayer' {
  interface __DictionaryRegistry {
    "flash-deals": typeof _kvn7m6mlza;
    "home-page": typeof _yctx0wccf8;
    "locale-switcher": typeof _2fhxby7fg24;
    "mobileBottomNav": typeof _kiu1rn7miq;
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
