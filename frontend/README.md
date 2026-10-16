# Frontend (Next.js)

The web app for Pi Classifieds. See the [repository README](../README.md) for
setup, environment variables and the commands that run both apps together.

From this directory:

```bash
npm ci
npm run dev          # http://localhost:3000 (expects the API on NEXT_PUBLIC_API_URL)
npm run typecheck
npm run lint
npm run build        # outputs .next/standalone (used by the Dockerfile)
```

Notes

* Routes live in `app/` with no locale segment; the language (en / sw / lg / ach)
  is resolved from a cookie / `Accept-Language` by Intlayer (`intlayer.config.ts`).
  Use `<T>text</T>` / `useTr()` (`components/ui/T.tsx`, `lib/i18n`) for inline strings.
* All API calls go through `lib/api.ts`; server components import only
  `lib/apiUrl.ts` (the client module pulls in browser-only session code).
* `.intlayer/` and `.next/` are generated — never commit them.
