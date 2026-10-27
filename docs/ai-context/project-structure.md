# Project Structure

> Tier 1 (Entry Point) — referenced from [CLAUDE.md](../../CLAUDE.md). See [docs-overview.md](docs-overview.md) for full documentation navigation.

## Tech Stack

- **Framework**: Astro 7 (SSR, `@astrojs/netlify` adapter)
- **Styling**: Tailwind CSS 4 (`@tailwindcss/vite`)
- **Database/Auth**: Supabase (`@supabase/supabase-js`)
- **Hosting**: Netlify (see `netlify.toml`, `netlify/functions/`). In `astro dev`, the adapter's local edge-functions server is off (`devFeatures.edgeFunctions: false` in `astro.config.mjs`): the site has no edge functions.
- **Language**: TypeScript
- **Other**: `qrcode` (check-in QR generation)
- **Testing**: Vitest (unit), Playwright (end-to-end, using the installed Edge)
- **Node**: >=22.12.0

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` (or `astro dev --background`, see CLAUDE.md) | Start local dev server |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview a production build locally |
| `npm run astro ...` | Run Astro CLI commands (e.g. `astro check`) |
| `npm test` / `npm run test:unit` / `npm run test:e2e` | Unit tests (Vitest), end-to-end tests (Playwright in Edge), or both; see tests/CONTEXT.md |

## File Tree

```
/
├── astro.config.mjs
├── netlify.toml
├── netlify/functions/
│   └── scheduled-calendar-sync.mts      # Scheduled Netlify function
├── public/                              # Static assets (favicon, venmo QR)
├── supabase/migrations/                 # Numbered SQL migrations (0001-0054); a new table must be granted to service_role in its migration (see 0045)
├── src/
│   ├── assets/                          # Image assets (highlights, stock)
│   ├── components/                      # Astro components (Header, Footer, forms, banners, calendar picker; admin DealsAdmin, ErrorsQueue, SiteTimeZoneSetting)
│   ├── middleware.ts                    # Loads the site time zone for each request (checks nothing else)
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── lib/                             # Server-side helpers
│   │   ├── admin.ts                     # Admin auth/session helpers
│   │   ├── adminSession.ts              # Browser-only shared admin check (refreshes stale sessions, local sign-out)
│   │   ├── apiUsage.ts                  # API usage tracking (e.g. Google Places quota, daily caps)
│   │   ├── calendarSync.ts              # Google Calendar sync logic
│   │   ├── capacity.ts                  # Per-series capacity: spots remaining per occurrence (a general cap, or separate Leader/Follower caps for classes), from the trigger-maintained event_spot_counts cache; server-side full check
│   │   ├── attendanceMatching.ts        # Matches sign-ups to check-ins per dancer, expanding series sign-ups into per-occurrence entries
│   │   ├── checkinToken.ts              # Signed per-event token authorizing check-in auto-registration (QR link)
│   │   ├── classRegistrations.ts        # One-row-per-(dancer,class) registration records with snapshotted prices
│   │   ├── classFilterGroup.ts          # Browser-only multi-row class filter for the dancer dashboard
│   │   ├── classSeries.ts               # Recurring class series logic
│   │   ├── recyclingBin.ts              # Soft delete / restore / empty for the dashboard Recycling Bin
│   │   ├── duplicateFlag.ts / duplicateSubmissions.ts  # Auto-detect double-submitted sign-ups/check-ins → Recycling Bin
│   │   ├── editLock.ts                  # Admin edit-lock (prevents concurrent edits)
│   │   ├── email.ts                     # Transactional email sending
│   │   ├── eventTimes.ts                # Event end-time rules (an end before the start is the next day), pure
│   │   ├── eventColors.ts               # Event colors (legacy names or picked #rrggbb): styles, readable text, closest Google color, recent picks
│   │   ├── errorDialog.ts               # Browser-only copyable error modal (sync/save failures)
│   │   ├── env.ts                       # Env var access/validation
│   │   ├── communityGuidelines.ts       # Community guidelines event registrants agree to; split into FAQ-style items for confirmations
│   │   ├── deals.ts, dealsStore.ts      # Bundle deals: shared pricing (form + server) and the deals table
│   │   ├── contactMessages.ts           # Contact form messages (own table, not sign-ups), with double-submit check
│   │   ├── emailTypos.ts, emailHints.ts, emailDomain.ts  # Mistyped-email suggestions and domain checks on the forms
│   │   ├── siteErrors.ts                # The dashboard's Errors workqueue: bounces, Google API errors, failed emails and sign-ups
│   │   ├── siteTime.ts, siteConfig.ts   # The site time zone every date follows (admin setting; loaded by src/middleware.ts)
│   │   ├── resendWebhook.ts             # Resend bounce webhook signature check; bounces flagged on the dashboard
│   │   ├── registrationConfirmation.ts  # Builds the sign-up confirmation email (sent on sign-up, resent by admins)
│   │   ├── faqs.ts                      # FAQ list persistence
│   │   ├── googleCalendar.ts            # Google Calendar API client
│   │   ├── homepageContent.ts           # Editable homepage copy (lesson overview) persistence
│   │   ├── imageCropper.ts              # Browser-only crop dialog for event images (locked 16:3 banner, 1536x288 JPEG)
│   │   ├── notificationSettings.ts      # Admin-editable notification recipients + per-IP email caps
│   │   ├── previewMode.ts               # Draft/preview banner state
│   │   ├── pricing.ts                   # Tiered (early-bird/flash-sale) pricing resolution, pure/isomorphic
│   │   ├── registrationEmail.ts         # HTML for the dancer registration-confirmation email
│   │   ├── registrationReceipt.ts       # Itemized classes + subtotal for the confirmation page/email
│   │   ├── richText.ts                  # Allow-list HTML sanitizer for admin-authored rich text
│   │   ├── siteBanner.ts                # Site-wide announcement banner
│   │   ├── siteSettings.ts              # Site settings persistence
│   │   ├── supabase.ts / supabaseBrowser.ts  # Supabase clients (server/browser)
│   │   ├── testMode.ts                  # Dev-server-only switches the e2e suite uses (email sink, Google off, no quotas)
│   └── pages/
│       ├── index.astro (flyer blocks: each flyer beside its classes' live details), about.astro, contact.astro, contact/confirmation.astro, privacy-policy.astro, calendar.astro
│       ├── register.astro, register/events.astro, register/confirmation.astro
│       ├── check-in.astro, check-in/[eventId].astro, check-in/confirmation.astro
│       ├── admin.astro, admin/analytics.astro, admin/checkin-qr.astro, admin/inbox.astro
│       └── api/
│           ├── banner.ts, faqs.ts, homepage-content.ts, settings.ts, submit-checkin.ts, submit-intake.ts, test-mode.ts (dev-only)
│           └── admin/                    # Admin-only API routes (events, signups, sync, lock, uploads, FAQs, homepage content, inbox)
├── tests/                               # Vitest unit tests (tests/unit) + Playwright e2e tests (tests/e2e); see tests/CONTEXT.md
└── docs/ai-context/                     # This Tier 1 documentation set
```

## Domain Overview

The site is a bachata dance-class business site: public pages for class info, registration/intake, and check-in, plus an admin area (`/admin`, `/admin/*`, `/api/admin/*`) for managing events, class series, signups, check-ins, attendance matching/reconciliation, Google Calendar sync, site settings/banner, an editable FAQ list, community guidelines, bundle deals, a homepage built from class/event flyers (admin-reorderable blocks, per-class overrides of the lesson-overview section, and editable deal notes), and an inbox.

- **Event editor**: classes and events are edited in a sectioned editor on `/calendar`. Its section menu is a list on desktop and a sideways-scrolling chip row on phones. It offers any color (a picker plus the five most recently used colors), a single capacity cap or separate Leader/Follower caps for classes, and tiered pricing. Calendar banner text shrinks to fit, and all banners share one size.
- **Registration**: shows an itemized subtotal (also on the confirmation page and email, optionally BCC'd to admins) and enforces capacity, per role where capped. Event registrants agree to the community guidelines, which event confirmations list FAQ-style. Double-submitted sign-ups and check-ins are moved to the Recycling Bin automatically.
- **Check-in**: a public picker, plus admin QR codes for one or several classes that can optionally register drop-in attendees.
- **Data**: stored in Supabase (see `supabase/migrations/`; each table is granted to `service_role` explicitly). The admin area uses edit-locks to avoid concurrent-edit conflicts.
