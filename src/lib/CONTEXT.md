# src/lib Context

> Tier 2 — referenced from [docs-overview.md](../../docs/ai-context/docs-overview.md). Server-side helper modules shared across pages and API routes.

## Purpose

Everything here runs server-side (Astro SSR pages, `/api/*` routes, the scheduled Netlify function). No file in this directory is safe to import from client-side `<script>` blocks except `supabaseBrowser.ts` and `theme.ts`, which are written for the browser specifically.

## Key Files

| File | Purpose |
| --- | --- |
| `admin.ts` | `isAdminEmail` / `requireAdmin` — gate admin pages and API routes by Supabase session email |
| `apiUsage.ts` | `checkAndIncrementUsage` — daily quota counter (used for Google Places API calls) |
| `calendarSync.ts` | `runCalendarSync` — pulls Google Calendar events into Supabase for public + private calendars |
| `classSeries.ts` | Builds recurring class occurrence lists (`buildClassSeriesList`) in `America/Chicago` time |
| `deletionAudit.ts` | `recordDeletion` / `lookbackCutoffIso` — audit log for deleted signups, with lookback window |
| `editLock.ts` | Admin edit-lock (`tryAcquireLock`/`releaseLock`/`requireLock`) preventing concurrent edits, 10-min TTL |
| `email.ts` | `sendAdminNotification` — transactional email to admins |
| `env.ts` | `env(key)` — thin env var accessor |
| `faqs.ts` | `listFaqs` — public FAQ list persistence, answers sanitized via `richText.ts` |
| `googleCalendar.ts` | Google Calendar API client: OAuth refresh, list/insert/update/delete events, color mapping, recurrence rule building |
| `homepageContent.ts` | `getHomepageContent`/`setHomepageContent` — editable homepage copy (lesson overview), sanitized via `richText.ts` |
| `notificationSettings.ts` | `getNotificationRecipients`/`setNotificationRecipients` — admin-editable Contact-form notification recipient list |
| `previewMode.ts` | Browser-side flag for admins previewing the site as a public visitor |
| `richText.ts` | `sanitizeRichHtml` — regex-based allow-list HTML sanitizer for admin-authored rich text (event descriptions, FAQ answers, homepage copy) |
| `siteBanner.ts` | Site-wide announcement banner get/set, with HTML sanitization |
| `siteSettings.ts` | Boolean site settings (`hide_about_nav`, `hide_contact_nav`, `hide_checkin_nav`) persistence |
| `supabase.ts` | Server Supabase client (service role key) |
| `supabaseBrowser.ts` | Browser Supabase client (anon key) — the one exception safe to import client-side |
| `theme.ts` | Browser-side light/dark theme get/set — the other client-safe exception |

## Integration Points

- **Depends on**: Supabase (`supabase.ts`), Google Calendar OAuth credentials (`googleCalendar.ts`), `env.ts` for config
- **Used by**: `src/pages/api/admin/*` (most heavily — locking, calendar sync, signups, settings), `src/pages/admin*.astro`, `netlify/functions/scheduled-calendar-sync.mts` (calls `calendarSync.ts`)

## Architecture

**Calendar sync flow**: `netlify/functions/scheduled-calendar-sync.mts` (cron) or an admin-triggered API route → `calendarSync.runCalendarSync()` → `googleCalendar.ts` (Google API) → Supabase `events` table, separately for public and private calendars.

**Admin write flow**: API route → `admin.requireAdmin()` → (for editable resources) `editLock.requireLock()` → mutate via Supabase → `deletionAudit.recordDeletion()` if deleting a signup.
