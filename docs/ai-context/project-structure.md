# Project Structure

> Tier 1 (Entry Point) — referenced from [CLAUDE.md](../../CLAUDE.md). See [docs-overview.md](docs-overview.md) for full documentation navigation.

## Tech Stack

- **Framework**: Astro 7 (SSR, `@astrojs/netlify` adapter)
- **Styling**: Tailwind CSS 4 (`@tailwindcss/vite`)
- **Database/Auth**: Supabase (`@supabase/supabase-js`)
- **Hosting**: Netlify (see `netlify.toml`, `netlify/functions/`)
- **Language**: TypeScript
- **Other**: `qrcode` (check-in QR generation)
- **Node**: >=22.12.0

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` (or `astro dev --background`, see CLAUDE.md) | Start local dev server |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview a production build locally |
| `npm run astro ...` | Run Astro CLI commands (e.g. `astro check`) |

## File Tree

```
/
├── astro.config.mjs
├── netlify.toml
├── netlify/functions/
│   └── scheduled-calendar-sync.mts      # Scheduled Netlify function
├── public/                              # Static assets (favicon, venmo QR)
├── supabase/migrations/                 # Numbered SQL migrations (0001-0037)
├── src/
│   ├── assets/                          # Image assets (highlights, stock)
│   ├── components/                      # Astro components (Header, Footer, forms, banners, calendar picker)
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── lib/                             # Server-side helpers
│   │   ├── admin.ts                     # Admin auth/session helpers
│   │   ├── apiUsage.ts                  # API usage tracking (e.g. Google Places quota, daily caps)
│   │   ├── calendarSync.ts              # Google Calendar sync logic
│   │   ├── attendanceMatching.ts        # Matches sign-ups to check-ins per dancer, expanding series sign-ups into per-occurrence entries
│   │   ├── classRegistrations.ts        # One-row-per-(dancer,class) registration records with snapshotted prices
│   │   ├── classSeries.ts               # Recurring class series logic
│   │   ├── deletionAudit.ts             # Audit log for deleted signups
│   │   ├── editLock.ts                  # Admin edit-lock (prevents concurrent edits)
│   │   ├── email.ts                     # Transactional email sending
│   │   ├── env.ts                       # Env var access/validation
│   │   ├── faqs.ts                      # FAQ list persistence
│   │   ├── googleCalendar.ts            # Google Calendar API client
│   │   ├── homepageContent.ts           # Editable homepage copy (lesson overview) persistence
│   │   ├── imageCropper.ts              # Browser-only crop dialog for event images (locked 16:3 banner, 1536x288 JPEG)
│   │   ├── notificationSettings.ts      # Admin-editable notification recipients + per-IP email caps
│   │   ├── previewMode.ts               # Draft/preview banner state
│   │   ├── pricing.ts                   # Tiered (early-bird/flash-sale) pricing resolution, pure/isomorphic
│   │   ├── registrationEmail.ts         # HTML for the dancer registration-confirmation email
│   │   ├── richText.ts                  # Allow-list HTML sanitizer for admin-authored rich text
│   │   ├── siteBanner.ts                # Site-wide announcement banner
│   │   ├── siteSettings.ts              # Site settings persistence
│   │   ├── supabase.ts / supabaseBrowser.ts  # Supabase clients (server/browser)
│   └── pages/
│       ├── index.astro, about.astro, contact.astro, contact/confirmation.astro, privacy-policy.astro, calendar.astro
│       ├── register.astro, register/events.astro, register/confirmation.astro
│       ├── check-in.astro, check-in/[eventId].astro, check-in/confirmation.astro
│       ├── admin.astro, admin/analytics.astro, admin/checkin-qr.astro, admin/inbox.astro
│       └── api/
│           ├── banner.ts, faqs.ts, homepage-content.ts, settings.ts, submit-checkin.ts, submit-intake.ts
│           └── admin/                    # Admin-only API routes (events, signups, sync, lock, uploads, FAQs, homepage content, inbox)
└── docs/ai-context/                     # This Tier 1 documentation set
```

## Domain Overview

The site is a bachata dance-class business site: public pages for class info, registration/intake, and check-in, plus an admin area (`/admin`, `/admin/*`, `/api/admin/*`) for managing events, class series, signups, check-ins, attendance matching/reconciliation, Google Calendar sync, site settings/banner, an editable FAQ list, editable homepage copy, and an inbox. Data is stored in Supabase (see `supabase/migrations/`); the admin area uses edit-locks to avoid concurrent-edit conflicts.
