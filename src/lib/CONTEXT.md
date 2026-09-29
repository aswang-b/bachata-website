# src/lib Context

> Tier 2 — referenced from [docs-overview.md](../../docs/ai-context/docs-overview.md). Server-side helper modules shared across pages and API routes.

## Purpose

Almost everything here runs server-side (Astro SSR pages, `/api/*` routes, the scheduled Netlify function) and must never be imported from client-side `<script>` blocks. The client-safe exceptions are `supabaseBrowser.ts` and `previewMode.ts` (browser-only), `imageCropper.ts` (browser-only, uses DOM/canvas), and `pricing.ts` (pure, so it works in both).

## Key Files

| File | Purpose |
| --- | --- |
| `admin.ts` | `isAdminEmail` / `requireAdmin` — gate admin pages and API routes by Supabase session email |
| `attendanceMatching.ts` | `expandRegistrationsToEntries`/`matchAttendance` — matches `class_registrations` to `class_checkins` per dancer (name required, phone/email only disambiguates same-named candidates); Whole-Series rows expand into one entry per occurrence, Drop-In rows use their stored `occurrence_event_id` when present (else a best-effort last-occurrence guess for legacy rows); backs the admin Attendance tab's matches table and orphan workqueue; a check-in with no `event_id` (its class wasn't scheduled that day — `submit-checkin.ts` still saves it by title) can't match a dated entry until an admin links it to an occurrence |
| `apiUsage.ts` | `checkAndIncrementUsage` — daily quota counter keyed by a free-text name (Google Places, `resend_email` for admin notifications, `resend_confirmation_email` for dancer confirmations) |
| `calendarSync.ts` | `runCalendarSync` — pulls Google Calendar events into Supabase for public + private calendars, carrying forward per-series price/discount/`registration_closed` metadata onto freshly-synced occurrence rows |
| `classSeries.ts` | Builds recurring class occurrence lists (`buildClassSeriesList`) in `America/Chicago` time, including each series' tiered-pricing/registration-closed fields; `chicagoDayBoundsUtcIso` gives today's day boundary in that timezone for check-in occurrence resolution |
| `deletionAudit.ts` | `recordDeletion` / `lookbackCutoffIso` — audit log for deleted signups, with lookback window |
| `classRegistrations.ts` | One-row-per-(dancer,class) registration records (`class_registrations` table). `resolveClassSelections` prefers the structured `class_selections` JSON (keyed by series id, carries the chosen Drop-In `occurrenceEventId`) over the legacy semicolon-joined `class` string; `insertClassRegistrations`/`replaceClassRegistrations` snapshot each class's `pricing.getActivePrice()` result (base or active early-bird/flash-sale tier) at write time; `validateClassSelections` is the server-side backstop rejecting submissions against a `registration_closed` class (400; fails closed with a 503 retry message if the lookup errors) (by key when the selection has one, title only as a keyless fallback); price/closed lookups query only the rows a submission references, and keyed rows are stored under the key's own event title, not the client's; `sanitizeOccurrenceIds` nulls any client-supplied Drop-In `occurrenceEventId` that isn't a class event in the selected series; the admin Sign-Ups edit uses `updateDancerOnClassRegistrations` (refresh dancer details in place, keeping row ids/prices/dates) and `setDropInOccurrences` (validated per-registration Drop-In date changes, `ClassRegistrationInputError` → 400) instead of rebuilding rows when no new classes are picked |
| `editLock.ts` | Admin edit-lock (`tryAcquireLock`/`releaseLock`/`requireLock`) preventing concurrent edits, 10-min TTL |
| `email.ts` | `sendEmail(to, subject, html)` — generic Resend send; `sendAdminNotification` — sends to the admin recipient list via `sendEmail` |
| `registrationEmail.ts` | `buildRegistrationConfirmationEmailHtml` — inline-styled HTML for the dancer confirmation email (dancer rows, classes, payment, subtotal, and the FAQs flagged `includeInConfirmation`), mirroring what `/register/confirmation` prints |
| `env.ts` | `env(key)` — thin env var accessor |
| `faqs.ts` | `listFaqs` — public FAQ list persistence, answers sanitized via `richText.ts`; each FAQ carries `includeInConfirmation`, which controls only the printed/emailed confirmation (the on-screen lists always show every FAQ) |
| `googleCalendar.ts` | Google Calendar API client: OAuth refresh, list/insert/update/delete events, color mapping, recurrence rule building. `getGoogleAccessToken` tries every stored admin token freshest-first and skips ones Google rejects as expired/revoked (`GoogleAuthError`), throwing `GoogleNotConnectedError`/`GoogleAuthExpiredError` when none work — every Calendar call site uses it instead of picking a token row itself |
| `homepageContent.ts` | `getHomepageContent`/`setHomepageContent` — editable homepage copy (lesson overview), sanitized via `richText.ts` |
| `imageCropper.ts` | Browser-only. `openImageCropper(file)` opens the crop dialog the calendar event editor uses before uploading an event image: a draggable, zoomable box locked to the homepage offering-card banner shape (16:3, exported as a 1536×288 JPEG) with a dashed "phone view" guide; resolves `null` if cancelled |
| `notificationSettings.ts` | `getNotificationRecipients`/`setNotificationRecipients` — admin-editable Contact-form notification recipient list; also the per-IP daily caps (`get`/`setConfirmationEmailPerIpCap`, default 50; `get`/`setContactEmailPerIpCap`, default 3), stored on the same singleton row and applied in `submit-intake.ts` — over the cap only the email is skipped, never the registration — and `get`/`setCheckinPerIpCap` (default 300, per class checked into) applied in `submit-checkin.ts`, which rejects with 429 once reached |
| `previewMode.ts` | Browser-side flag for admins previewing the site as a public visitor |
| `pricing.ts` | `getActivePrice`/`priceTierLabel` — resolves early-bird/flash-sale tiered pricing against a given time; pure (no Supabase/env imports) so it's safe from both SSR frontmatter and client `<script>` bundles |
| `richText.ts` | `sanitizeRichHtml` — regex-based allow-list HTML sanitizer for admin-authored rich text (event descriptions, FAQ answers, homepage copy) |
| `siteBanner.ts` | Site-wide announcement banner get/set, with HTML sanitization |
| `siteSettings.ts` | Boolean site settings (`hide_about_nav`, `hide_contact_nav`, `hide_checkin_nav`, `disable_checkin_page`) persistence |
| `supabase.ts` | Server Supabase client (service role key) |
| `supabaseBrowser.ts` | Browser Supabase client (anon key) — the one exception safe to import client-side |

## Integration Points

- **Depends on**: Supabase (`supabase.ts`), Google Calendar OAuth credentials (`googleCalendar.ts`), `env.ts` for config
- **Used by**: `src/pages/api/admin/*` (most heavily — locking, calendar sync, signups, settings), `src/pages/admin*.astro`, `netlify/functions/scheduled-calendar-sync.mts` (calls `calendarSync.ts`)

## Architecture

**Calendar sync flow**: `netlify/functions/scheduled-calendar-sync.mts` (cron) or an admin-triggered API route → `calendarSync.runCalendarSync()` → `googleCalendar.ts` (Google API) → Supabase `events` table, separately for public and private calendars.

**Admin write flow**: API route → `admin.requireAdmin()` → (for editable resources) `editLock.requireLock()` → mutate via Supabase → `deletionAudit.recordDeletion()` if deleting a signup.

**Registration flow**: `submit-intake.ts` validates (format-checked emails, closed-class check) → inserts `intake_submissions` → `classRegistrations.insertClassRegistrations()` snapshots one priced row per (dancer, class) → for group/events registrations, `registrationEmail.ts` builds the confirmation, sent via `email.sendEmail` to each dancer email under a per-IP cap (`notificationSettings.ts`) and a global daily cap (`apiUsage.ts`); a failed or capped email never fails the registration. `/register/confirmation` prints the same content.

**Tiered-pricing flow**: admin sets per-series base/early-bird/flash-sale prices + `registration_closed` on an `events` row (`create-event.ts`/`update-event.ts`) → `calendarSync.ts` carries those fields onto every occurrence row on sync → `classSeries.buildClassSeriesList()` surfaces them to pages → `pricing.getActivePrice()` resolves the currently-active price/tier at both display time (`calendar.astro`) and registration time (`classRegistrations.ts`, which also snapshots the resolved tier per row).
