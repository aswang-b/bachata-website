# src/components Context

> Tier 2 — referenced from [docs-overview.md](../../docs/ai-context/docs-overview.md). Shared Astro components used across public pages.

## Purpose

Reusable UI pieces included by pages in `src/pages/`. All are `.astro` components; interactivity (where present) is plain DOM script in an inline `<script>` block, not a framework component — this project has no React/Vue/Svelte components.

## Key Files

| File | Purpose |
| --- | --- |
| `Header.astro` | Sticky site nav; nav items can be hidden per `siteSettings` keys (`hide_about_nav`, etc.); highlights the admin page differently. The Register for Classes / Events buttons stay in the header row at every width (switching to short "Classes"/"Events" labels when space runs out), so the phone menu doesn't repeat them |
| `Footer.astro` | Site footer with social links |
| `AnnouncementBanner.astro` | Fetches `/api/banner`, shows a dismissible site-wide banner (dismissal tracked in session storage) |
| `PreviewBanner.astro` | Shown when an admin is previewing the site as a public visitor (`lib/previewMode.ts`); lets them exit preview |
| `CookieConsent.astro` | Cookie consent bar, links to `/privacy-policy` |
| `DanceHighlights.astro` | Auto-discovers images in `src/assets/highlights/*` via `import.meta.glob` and renders an autoplaying slideshow — no code changes needed to add/remove photos |
| `ClassCalendarPicker.astro` | Check-in class picker (colored by `lib/eventColors.ts`, so picked custom colors show). Renders a list of upcoming `ClassEvent`s as selectable radio-style cards (`events`, `required`, `emptyMessage` props); on selection writes both the legacy display string (`class`) and the structured `class_selections` JSON (`{ key, title, label, mode }`, series-id-keyed) that `classRegistrations.resolveClassSelections` reads |
| `RegistrationForm.astro` | The whole public sign-up page for `/register` (`kind="class"`) and `/register/events` (`kind="event"`): pick one or more classes/events, up to 5 dancers, subtotal, cash/Venmo. Events sell one ticket price (no Whole Series / Drop In), skip the Leader/Follower role, and only ask for payment when the subtotal is above $0. Full or closed entries can't be picked; spots show where the class/event allows it, per role for classes capped by Leader/Follower (a full role blocks a dancer in that role before submitting). Events with community guidelines show them in a scroll box above the subtotal with a required agreement checkbox. A blocked submit scrolls to the first problem (a missing dancer detail focuses that dancer's empty field). Bundle deals (`lib/deals.ts`) show as discount lines in the subtotal, and a class that would complete a deal is offered under it with an Add button |
| `DealsAdmin.astro` | Admin → Deals tab (included by `admin.astro`, loads on first open): list, create, edit, pause and delete bundle deals via `/api/admin/deals`, picking from upcoming public classes/events, with a live summary ("Both for $40 (they're $50 today)") |
| `IntakeForm.astro` | Shared registration/contact form; wraps `ClassCalendarPicker` when `classEvents` are supplied; configurable via props (`registrationType`, `heading`, `commentsLabel`, `contactMethodPicker`, etc.) for reuse across register/contact/check-in-style flows |

## Integration Points

- **Depends on**: `src/lib/previewMode.ts` (PreviewBanner), `/api/banner` (AnnouncementBanner), `src/assets/highlights/` (DanceHighlights), `src/lib/siteSettings.ts` values passed in as `data-settings-key` (Header)
- **Used by**: `BaseLayout.astro` (Header, Footer, banners, CookieConsent globally); `register.astro`, `contact.astro`, `check-in.astro` (IntakeForm); `IntakeForm.astro` (ClassCalendarPicker)

## Architecture

`IntakeForm` is the shared skeleton for every "collect visitor info" flow (registration, contact, check-in); pages differentiate behavior purely through props rather than separate form components, so changes to shared field markup/validation belong here rather than being duplicated per page.
