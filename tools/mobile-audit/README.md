# Mobile / layout audit scripts

Headless-Chromium checks that caught the mobile header problems fixed in this release. They run against a
**running** stack (frontend on :3000 by default) and print one line per page.

```bash
cd tools/mobile-audit
npm init -y && npm i -D puppeteer-core @sparticuz/chromium      # one-off

W=390 node header-sticky-check.mjs        # header position before/after scrolling + screenshots in /tmp/shots
WIDTHS=320,390 node page-sweep.mjs        # per page: HTTP status, horizontal overflow, header sticky, JS/network errors
node pinned-text-check.mjs                # links/buttons whose label is pinned to the top of an over-tall box
```

`page-sweep.mjs` flags `HEADER-NOT-STICKY`, `H-SCROLL`, `OVER:` (element wider than the screen), `JS:` and `NET:`.
Env: `PAGES=/,/listings,...` and `WIDTHS=320,390,768` override the defaults. Emulated Chromium only — also try a real
iPhone/Android before a release. (Remove `--single-process`/`--no-zygote` from the launch args if your Chromium crashes.)
