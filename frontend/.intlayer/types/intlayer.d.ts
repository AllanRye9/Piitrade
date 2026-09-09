import "intlayer";
import _1xf7nm76tsb from './flash-deals.ts';
import _1dh63d65djk from './home-page.ts';
import _1u1si1m60rz from './locale-switcher.ts';
import _lw7outfesv from './mobileBottomNav.ts';

declare module 'intlayer' {
  interface __DictionaryRegistry {
    "flash-deals": typeof _1xf7nm76tsb;
    "home-page": typeof _1dh63d65djk;
    "locale-switcher": typeof _1u1si1m60rz;
    "mobileBottomNav": typeof _lw7outfesv;
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
