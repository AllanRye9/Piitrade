# Tests that are not part of the project's own test setup

Backend tests (`backend/src/**/*.test.ts`, `*.integration.test.ts`) are inside the project tree in this bundle and run with the
project's own commands (`npm test`; `TEST_DATABASE_URL=… npm run test:integration`).

## frontend/  (the frontend has no test runner configured yet)
Copy `frontend/navtest/`, `vitest.nav.config.mjs` (and `vitest.e2e.config.mjs`) into the `frontend/` project folder, then:

    npm i -D vitest@2 jsdom @testing-library/react@16 @testing-library/dom @vitejs/plugin-react@4 --legacy-peer-deps
    npx vitest run --config vitest.nav.config.mjs        # 126 tests

## e2e/  (real server + real client library; optional)
`live.e2e.test.ts` boots nothing itself: start the backend on port 5055 against a freshly migrated database first.
`e2e_seed.ts` (run with `npx tsx` from the backend folder) creates a buyer with a "Land under 5M" alert, a seller and a land category,
and prints a token; save its last line to /tmp/e2e_seed.json. Then `npx vitest run --config vitest.e2e.config.mjs` in the frontend folder.
It inserts listings straight into the database and checks the alert reaches the connected client (measured ~60 ms locally).
