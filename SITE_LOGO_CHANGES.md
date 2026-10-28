# Site Logo: what changed

The one Site Logo (Admin -> Site Media Manager -> "Site Logo", exactly 1 image) now also drives the browser-tab icon.

Already working (audited, unchanged): header (desktop + mobile menu), footer (desktop + mobile), admin sidebar (+ mobile top bar),
sign-in / sign-up pages, welcome popup tagline. Each keeps its link to the homepage. The backend already enforces exactly 1 image and
deactivates the previous logo.

New / changed
- app/layout.tsx: tab icon, shortcut icon and iOS home-screen icon = Site Logo (built-in icon when none is uploaded).
- lib/siteLogo.ts (new): server fetch of the active logo (cached 60 s) + browser-safe URL handling.
- components/ui/BrandLogo.tsx: the logo is now rendered in the server HTML (BrandLogoProvider), so there is no flash of the "Pi"/"Piitrade" fallback.
- components/ui/SiteIconSync.tsx (new): updates the tab icon immediately after an admin uploads, replaces or removes the logo.
- app/manifest.ts (new, replaces public/manifest.json): installed-app icon = Site Logo.
- app/icon.svg and app/favicon.ico moved to public/ (same URLs). Next's file-based icons override metadata icons, so they had to move for the logo to win.
- PublicShell.tsx: corrected a stale comment saying the header never shows the uploaded logo.

Not changed on purpose: the exchange-widget logo (a separate feature), the push-notification icon in public/sw.js (/icon.svg), and the static global-error page.

Browsers cache favicons aggressively: a replaced logo can take a reload (and up to ~60 s of server cache) to show in the tab.
