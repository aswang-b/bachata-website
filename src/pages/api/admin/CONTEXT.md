# src/pages/api/admin Context

> Tier 3 — referenced from [docs-overview.md](../../../../docs/ai-context/docs-overview.md). Admin-only JSON API routes backing `/admin`, `/admin/analytics`, `/admin/checkin-qr`, `/admin/inbox`.

## Purpose

One file per endpoint (Astro API routes, `export const GET`/`POST`). Every route starts by calling `requireAdmin` (from [`src/lib/admin.ts`](../../../lib/CONTEXT.md)) against the request's Supabase session and returns 401/403 if that fails — there is no other auth layer in front of these.

## Key Files, by Resource

| Resource | Files | Notes |
| --- | --- | --- |
| **Events** | `all-events.ts` (GET), `create-event.ts`, `update-event.ts`, `delete-event.ts`, `upload-event-image.ts`, `sync-calendar.ts`, `store-google-token.ts` | Create/update write both the base price and tiered (early-bird/flash-sale) price/date fields plus `registration_closed`; for a recurring series they update every sibling occurrence row, not just the row edited. `sync-calendar.ts` triggers `calendarSync.runCalendarSync()` on demand (see [lib CONTEXT.md](../../../lib/CONTEXT.md)) |
| **Sign-ups** | `edit-signup.ts`, `update-signup.ts`, `restore-signup.ts`, `deleted-signups.ts` (GET) | Edits a dancer's `class_registrations`. Picked classes are sent as structured `classSelections` (series key, mode, and the chosen Drop-In `occurrenceEventId`) and replace the old rows; with `keepClasses: true` the existing rows are kept (ids, prices, Drop-In dates) and only the dancer details are refreshed in place, plus any `occurrenceUpdates` that set a Drop-In's class date (`classRegistrations.ts`'s `setDropInOccurrences`, validated against the registration's own class); restores read from `deletionAudit`'s lookback window |
| **Check-ins** | `edit-checkin.ts`, `restore-checkin.ts`, `deleted-checkins.ts` (GET), `checkin-classes.ts` (GET), `generate-checkin-qr.ts` | `checkin-classes.ts` lists classes eligible for today's check-in page; `generate-checkin-qr.ts` renders a QR (via `qrcode`) pointing at a check-in URL, used by `admin/checkin-qr.astro` |
| **Attendance** | `attendance-data.ts` (GET), `resolve-attendance.ts` | `attendance-data.ts` returns the raw registrations/checkins/series rows the Analytics page runs `attendanceMatching.ts` over client-side; `resolve-attendance.ts` records a manual match/no-show resolution for an orphaned row |
| **Analytics** | `analytics-data.ts` (GET) | Aggregate stats backing `admin/analytics.astro`'s summary tiles |
| **Edit locks** | `acquire-lock.ts`, `release-lock.ts`, `lock-status.ts` (GET), `check.ts` (GET) | Thin wrappers over `src/lib/editLock.ts`'s `SIGNUPS_LOCK_RESOURCE`/`CHECKINS_LOCK_RESOURCE`/`ATTENDANCE_LOCK_RESOURCE`; `check.ts` is a lightweight admin-session liveness probe, unrelated to locking despite living alongside it |
| **FAQs** | `create-faq.ts`, `update-faq.ts`, `delete-faq.ts`, `reorder-faq.ts` | CRUD + manual ordering over the public FAQ list (`src/lib/faqs.ts`) |
| **Site settings** | `update-settings.ts`, `update-banner.ts`, `update-homepage-content.ts`, `notification-settings.ts` (GET — recipients plus the per-IP email and check-in caps), `update-notification-settings.ts`, `update-confirmation-email-cap.ts`, `update-contact-email-cap.ts`, `update-checkin-cap.ts` | Thin wrappers over `siteSettings.ts`/`siteBanner.ts`/`homepageContent.ts`/`notificationSettings.ts` |
| **Inbox** | `inbox-data.ts` (GET), `unseen-count.ts` (GET) | Contact-form submissions; `unseen-count.ts` backs the nav badge in `Header.astro` |
| **Misc** | `places-usage-check.ts` (GET) | Reports the daily Google Places API quota counter from `src/lib/apiUsage.ts` |

## Integration Points

- **Depends on**: `src/lib/*` (almost every helper module — see [lib CONTEXT.md](../../../lib/CONTEXT.md) for what each does)
- **Used by**: `src/pages/admin.astro` (dashboard: sign-ups, check-ins, workqueue, matches) and this directory's sibling pages — see [admin pages CONTEXT.md](../../admin/CONTEXT.md)

## Architecture

**Auth pattern**: every route is `requireAdmin(request)` first, then the resource-specific logic — there's no shared middleware, so a new route must remember to call it itself.

**Editable-resource write pattern**: acquire the relevant lock (`acquire-lock.ts` / `editLock.requireLock()`) client-side before editing, release on save (`release-lock.ts`); the lock is advisory (10-min TTL, not DB-enforced) to stop two admin tabs from clobbering the same in-progress edit.
