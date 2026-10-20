# tests Context

> Tier 2 — referenced from [docs-overview.md](../docs/ai-context/docs-overview.md). The automated test suite: run it before pushing, and add a test whenever a bug is fixed so it can't come back.

## Running

| Command | What it does | Time |
| --- | --- | --- |
| `npm run test:unit` | Vitest unit tests (`tests/unit`). No network, no database. | ~1 s |
| `npm run test:e2e` | Playwright end-to-end tests (`tests/e2e`) in Edge against a dev server of their own on port 4322 | ~2 min |
| `npm test` | Both | |
| `npm run test:e2e:report` | Opens the HTML report of the last e2e run (traces and screenshots of failures) | |

The e2e run starts its own server via `tests/e2e/support/devServer.mjs`, alongside a `astro dev` you may already have running on 4321. If a run is killed midway and port 4322 stays busy, stop that process before the next run.

## Unit tests (`tests/unit`)

Pure logic plus server modules with Supabase replaced by `fakeSupabase.ts` (an in-memory query builder that records every call) and Google/`fetch` mocked.

| File | Guards |
| --- | --- |
| `calendarSync.test.ts` | Plain insert (not upsert) for new Google events, 23505 → update; no re-push of unchanged events (the 403 rate-limit bug); per-event errors collected, not thrown; series settings (type, prices, role caps) carried onto regenerated instances; nothing outside the 180-day window deleted or pushed |
| `googleAuth.test.ts` | Tokens without the Calendar scope rejected; dead tokens skipped freshest-first; rate-limit retries (only for real rate limits); 410 on delete is fine; pagination |
| `sessionAndDuplicates.test.ts` | Stale admin sessions refreshed, unrecoverable ones signed out with `scope: 'local'`; duplicate sign-up/check-in fingerprints |
| `capacity.test.ts` | Spot math, per-role caps, series = tightest class, labels, hidden-count labels, editor → row columns, server-side capacity check (fails closed) |
| `registration.test.ts` | Class-selection parsing/labels, closed classes by key, free vs paid events, itemized receipt, confirmation email (FAQs vs guidelines), check-in tokens |
| `scheduling.test.ts` | Midnight end times (`src/lib/eventTimes.ts`), tiered pricing, recurrence rules, color mapping |
| `content.test.ts` | Guidelines → FAQ-style sections, rich-text sanitizing |
| `codebaseRules.test.ts` | Source-level rules: every admin route calls `requireAdmin`, every `signOut` is local, no events upsert in the sync, forms don't lock their submit button, migrations numbered without gaps |

## End-to-end tests (`tests/e2e`)

Real browser flows against the **shared live database**, made safe by `src/lib/testMode.ts`: the test server (and only a dev server) writes emails to `tests/e2e/.output/emails.jsonl` instead of sending them, behaves as if Google Calendar isn't connected, and skips the daily email/check-in quotas. Every spec imports `test` from `support/fixtures.ts`, which refuses to run unless `/api/test-mode` confirms all three, then warms up each page (a fresh dev server force-reloads a page the first time it optimizes its scripts).

Test data rules (`support/db.ts`):
- Everything is prefixed `ZZZ` and deleted before and after each run (`globalSetup`/`globalTeardown`), including leftovers from a crashed run.
- Seeded events are dated past the sync's 180-day window and carry fake Google ids, so the live 15-minute sync never pushes them to Google.
- They are public while a run lasts (≈2 min), so they briefly appear on the live site's register pages.
- Tests that change a shared setting (the community guidelines) restore it afterwards. Nothing ever empties the Recycling Bin.
- Admin tests use a magic-link session made with the service role (`support/admin.ts`), always ended with a **local** sign-out.

| Spec | Covers |
| --- | --- |
| `public-pages` | Every public page renders without errors |
| `calendar-layout` | Calendar banner text (with a "Wk N" pill) stays inside its box at narrow widths, e.g. 125% zoom, and every banner shares one font size |
| `class-registration` | Full sign-up → itemized confirmation page and email (+ one BCC copy per the admin setting); drop-in date; whole-series-only and drop-in-only radios; closed classes; server validation; double submit → Recycling Bin → admin restore |
| `capacity` | Full classes; Leader/Follower caps (badge, form block, server refusal, role-edit recount); hidden counts |
| `event-registration` | Guidelines shown and required, confirmation/email list them FAQ-style; blank guidelines; free vs paid events |
| `checkin-and-contact` | QR check-in, duplicate check-in, contact form → admin notification |
| `admin-access` | Every admin API route rejects missing/bogus sessions; sign-in gate; stale-session recovery; sign-out is local only |
| `admin-editor` | Capacity toggle round trip; events have no role caps; midnight end times; editing before admin data loads; the section menu (desktop list, phone chip row that opens and scrolls to a section); Guidelines tab |
| `admin-dashboard` | Dashboard data (roles, events kept separate), dashboard page, check-in QR |

## Adding a test

- **Fixed a bug:** add the unit or e2e test that would have caught it.
- **New admin route:** `admin-access` and `codebaseRules` cover it automatically.
- **New page:** add it to `PAGES` in `public-pages.spec.ts` and `WARM_UP_PAGES` in `support/fixtures.ts`.
