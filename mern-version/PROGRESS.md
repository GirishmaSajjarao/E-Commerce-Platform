# MERN build progress

## Phase 1 — Workspace, database and authentication

Built the npm workspaces, Windows-compatible setup and seed commands, persistent development replica-set script, Docker and Atlas setup paths, Express configuration and health endpoint, Mongoose models, seed data, cookie authentication, roles, and a React sign-in screen.

- `npm.cmd install --ignore-scripts --no-audit --no-fund` installed 630 packages and generated the lockfile.
- `npm.cmd run setup` created the three local environment files.
- `npm.cmd test` passed 1 suite and 3 tests against MongoDB 7.0.14. Coverage included registration, cookie sessions, logout, role protection, and idempotent seeding. MongoDB emitted an ECONNRESET warning during teardown. The suite exited 0.
- Node module resolution initially failed with EPERM under the Windows workspace sandbox. The authorized rerun resolved it.

Open verification: persistent database restart, Docker, Atlas, and browser sign-in. Commerce, storefront pages, admin, chatbot, and QA workflows are tracked in later phases.

## Phase 2 — Commerce API

Built catalog search, customer carts, server-side totals, transactional checkout and stock updates, mock card/UPI/COD payment handling, order ownership checks, cancellation, returns and refunds, and admin order transitions.

- `npm.cmd test` passed 2 suites and 7 tests. Commerce coverage includes all three test cards, concurrent idempotency, client price tampering, stock, ownership, COD, tracking, cancellation and refunds.
- `npm.cmd run build -w client` built the sign-in client. Vite reported ignored dependency-level directives.
- The temporary Node installation disappeared between runs. Restoring it under the ignored workspace runtime directory allowed testing to continue.

Open verification: browser checkout, UPI through the API tests, expanded storage invariants, and the optional Stripe test integration.

## Phase 3 — Customer storefront

Built shop filters, product details, cart editing, checkout, confirmation, order history, tracking, cancellation and return controls.

- `npm.cmd test` passed 7 Jest tests in 2 suites and 3 Vitest tests in 1 file.
- `npm.cmd run build -w client` built 77 modules. The build reported dependency directives and unused Tailwind utilities.
- `npm.cmd run dev` initially found a standalone MongoDB already running on port 27017. With `DEV_MONGO_PORT=27018` and a matching `MONGODB_URI`, it started all three processes. `npm.cmd run seed` exited 0, the proxied health endpoint returned `{"status":"ok"}`, and the storefront returned HTTP 200.

Open verification: end-to-end browser flow and persistent restart. Support UI follows in Phase 5.

## Phase 4 — Administration

Built role-protected sales, orders, payments, customers, carts and inventory pages. Sales totals and charts read MongoDB records. Admin payment listings omit card fields.

- `npm.cmd test` passed 8 Jest tests in 2 suites and 3 Vitest tests in 1 file. The added test verified customer access denial, payment field omission, revenue and order counts, product creation and disablement, and stock validation.
- `npm.cmd run build -w client` completed and transformed 82 modules.

Open verification: browser admin workflows and chart rendering. Support insights and AI Quality follow in later phases.

## Phase 5 — Support chat and security evaluation

Built customer-scoped retrieval, server-side order actions with explicit confirmation, raw and guarded output handling, mock and Gemini providers, conversations, the chat widget, admin support insights and impersonation, and background security runs. Ported 22 security cases and added four.

- `npm.cmd test` passed 13 Jest tests in 3 suites and 3 Vitest tests in 1 file. All 26 stored mock security cases passed. Tests exercised retrieval ownership, stored address isolation, last-four handling, PII redaction, mocked Gemini errors, and confirmation before cancellation.
- `npm.cmd run build -w client` exited 0.
- The first run found a missing prefix on saved mock security answers. The rerun verified the fix.

The Gemini provider currently uses the Gemini REST endpoint with a mockable fetch adapter. Live Gemini, browser chat and external judging are unverified.

## Phase 6 — QA jobs, reports and evaluator

Added Promptfoo deterministic and rubric suites, result import, the HTTP-only Python evaluation worker, token-checked ingestion, stale-run recovery, job history, downloadable reports, settings, and database-derived scenarios.

- `npm.cmd test` passed 14 Jest tests in 3 suites and 3 Vitest tests in 1 file. `npm.cmd run build -w client` exited 0.
- `npm.cmd run qa:dataset` created 34 scenarios from the seeded store, for 66 total.
- `node .data/check-eval.mjs` started an isolated API and Python worker and verified DeepEval and Ragas callbacks both persisted `skipped` with zero scores.
- The same smoke command with `PROMPTFOO_NODE_BINARY` set used the Promptfoo CLI runner to import 18 results into MongoDB. All 18 passed, with 0 failures and 0 errors. The first run found an irrelevant product match for a laptop request. Catalog retrieval was tightened and the rerun passed.
- Promptfoo 0.125.1 reports a minimum Node version of 22.22. The app and regular tests used Node 20.20.0, while Promptfoo ran on Node 22.22.0.

Live Gemini, the rubric suite, and live DeepEval/Ragas scoring are unverified. No Gemini key was available in the execution environment.

## Phase 7 — Browser acceptance, CI and delivery

Added isolated Playwright page objects and browser tests, the Windows start and setup checks, a MERN GitHub Actions workflow, OpenAPI documentation, and a runnable Postman collection.

- `npm.cmd run lint` passed the JavaScript syntax checks.
- `npm.cmd test` passed 15 Jest tests in 3 suites and 3 Vitest tests in 1 file. Added UPI success and failure, empty cart, per-order totals and payment checks, and a card-number scan across test database collections.
- `npm.cmd run build -w client` built 83 modules successfully. Vite reported ignored dependency-level directives.
- `npm.cmd run test:e2e` with Chromium and `PROMPTFOO_NODE_BINARY` set passed 3 tests in 26.9 seconds. Verified checkout, shipment, tracking, chatbot access control, both failed card outcomes, and 18 imported QA results in the admin UI. The initial browser run found that the isolated storefront origin needed to be added to the test API allow-list. The reruns passed.
- `npm.cmd run setup`, `npm.cmd run seed`, and `node .data/check-persistence.mjs` verified fresh auto-start and restart on port 27019. All 4 users, 12 products, and 10 orders survived. The earlier combined dev smoke test used port 27018 because port 27017 was already taken. MongoDB occasionally logged ECONNRESET while shutting down and exited successfully.

Hosted CI, Postman execution, Docker, Atlas, and Gemini-backed jobs remain unverified. The optional Stripe test adapter is unimplemented. The npm lint command checks JavaScript syntax, and the Vite build checks JSX compilation.
