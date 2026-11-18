# Testing

Writing the code is not completion. A change is done when the type check, the linter and the tests pass, and every fixed bug has a regression test (`AGENTS.md` sections 2 and 6).

## Commands

```bash
npm run typecheck && npm run lint && npm test   # run before every commit
npm run test:e2e                                 # Playwright journeys, desktop and phone
npm run build                                    # the production build must pass too
```

Integration tests need the local Postgres: `npm run db:local:up` (the test setup also starts it).

## What runs where

| Kind | Where | What it covers |
| --- | --- | --- |
| Unit tests | `src/**/*.test.ts`, next to the code | Pure functions: parsers, product matching, formats, phone numbers, lead rules |
| Integration tests | `tests/*.test.ts` | Services against a real Postgres: sync, de-duplication, quotations, MCP and OAuth, row-level security |
| Price list import | `src/modules/catalog/price-list.test.ts`, `tests/price-list-import.test.ts` | Reading and matching (pure); the import as an owner under row-level security, refused for sales and viewers; every folder in `seed/` loads and its own list then shows nothing left to change. |
| Members and documents | `tests/members.test.ts`, `tests/documents.test.ts`, `src/modules/documents/types.test.ts` | Members and documents as signed-in roles under row-level security; upload checks; latest valid document; attachments on quotation drafts; both file storage adapters with fakes |
| Signed-in paths | `tests/human-paths.test.ts` | Every service called as an owner, a salesperson and a viewer **under row-level security**. System-context tests bypass RLS and hide permission bugs, so new services are tested here |
| Row-level security | `tests/rls.test.ts` | Company A cannot read or change company B; append-only tables; every table has RLS |
| IndiaMART | `tests/indiamart.test.ts` (fake IndiaMART; the fake throws on any other address) | Push endpoint, pull timing and limits, errors, merge with email, API-versus-email counts |
| Local mode | `tests/local-auth.test.ts`; `e2e/local-mode.spec.ts` with `npm run test:e2e:local` against a fresh `docker compose up` | Local sign-in, first-run owner, one-time links; the whole install in a browser |
| End to end | `e2e/smoke.spec.ts` | Critical journeys in a browser at 1440 px and 390 px; screenshots go to `docs/screenshots/` |

`npm test` recreates the database `inquira_test` from the migrations (`tests/global-setup.ts`) and runs test files one after another, because they share that database. `npm run test:e2e` recreates `inquira_e2e`, seeds it, loads demo data and starts `next dev` on port 3100 with development sign-in.

## Fakes

External services are never called from tests. Fakes live in `tests/helpers/` and **throw on any call the app is not allowed to make**.

| Fake | Replaces | Throws when |
| --- | --- | --- |
| `fakeGoogle()` in `tests/helpers/fake-google.ts` | Gmail API and Google's token endpoint | Any send endpoint is called |
| A `fetch` stub per test | TradeIndia's inquiry endpoint, IndiaMART's Pull API | Any other address |
| `fakeAi(reply)` in `tests/helpers/fake-ai.ts` | Gemini, Anthropic and OpenAI-compatible APIs; records every request body so tests can check what would leave the app | Any address that is not one of the three providers |

`tests/setup.ts` also replaces the global `fetch` for every test: anything but `localhost` throws "Test tried to reach …", so a missing fake fails the test instead of reaching a live service (AGENTS rule 13).

`tests/helpers/db.ts` has `resetDb`, `setupOrgWithUser(role)`, `createUser`, `addMember`, `systemCtx` and `mcpCtx`.

## Email fixtures

Each email layout the parsers support has a file in `fixtures/emails/` with the message and an `expected` block. `src/modules/email/parsers.test.ts` runs every fixture, so a new file is picked up automatically.

To add one:

1. Copy the closest existing fixture.
2. Replace every name, phone number, email address and company with invented ones. No real personal data goes into the repository (`AGENTS.md` rule 2).
3. Fill `expected` with the classification and the fields the parser must extract.
4. If the layout was rebuilt from a description and not from a raw email, set `"reconstructed": true` and ask for a real sample in `QUESTIONS.md`.

## Rules for new work

- A new service: a test in `tests/human-paths.test.ts` as a signed-in role.
- A new table: a case in `tests/rls.test.ts`.
- A fixed bug: a test that fails before the fix and passes after.
- A changed feature: also run the tests of the features that depend on it.
- Sign-in: no test may rely on a bypass. The sign-in regression test must stay green (GOAL G-PLT-1).
