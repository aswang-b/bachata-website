# src/components Context

> Tier 2 — referenced from [docs-overview.md](../../docs/ai-context/docs-overview.md). Shared Astro components used across public pages.

## Purpose

Reusable UI pieces included by pages in `src/pages/`. All are `.astro` components; interactivity (where present) is plain DOM script in an inline `<script>` block, not a framework component — this project has no React/Vue/Svelte components.

## Key Files

| File | Purpose |
| --- | --- |
| `Header.astro` | Sticky site nav; nav items can be hidden per `siteSettings` keys (`hide_about_nav`, etc.); highlights the admin page differently |
| `Footer.astro` | Site footer with social links |
| `AnnouncementBanner.astro` | Fetches `/api/banner`, shows a dismissible site-wide banner (dismissal tracked in session storage) |
| `PreviewBanner.astro` | Shown when an admin is previewing the site as a public visitor (`lib/previewMode.ts`); lets them exit preview |
| `CookieConsent.astro` | Cookie consent bar, links to `/privacy-policy` |
| `DanceHighlights.astro` | Auto-discovers images in `src/assets/highlights/*` via `import.meta.glob` and renders an autoplaying slideshow — no code changes needed to add/remove photos |
| `ClassCalendarPicker.astro` | Renders a list of upcoming `ClassEvent`s as selectable radio-style cards (`events`, `required`, `emptyMessage` props); on selection writes both the legacy display string (`class`) and the structured `class_selections` JSON (`{ key, title, label, mode }`, series-id-keyed) that `classRegistrations.resolveClassSelections` reads |
| `RegistrationForm.astro` | The whole public sign-up page for `/register` (`kind="class"`) and `/register/events` (`kind="event"`): pick one or more classes/events, up to 5 dancers, subtotal, cash/Venmo. Events sell one ticket price (no Whole Series / Drop In), skip the Leader/Follower role, and only ask for payment when the subtotal is above $0. Full or closed entries can't be picked; "X spots remaining" shows where the class/event allows it |
| `IntakeForm.astro` | Shared registration/contact form; wraps `ClassCalendarPicker` when `classEvents` are supplied; configurable via props (`registrationType`, `heading`, `commentsLabel`, `contactMethodPicker`, etc.) for reuse across register/contact/check-in-style flows |

## Integration Points

- **Depends on**: `src/lib/previewMode.ts` (PreviewBanner), `/api/banner` (AnnouncementBanner), `src/assets/highlights/` (DanceHighlights), `src/lib/siteSettings.ts` values passed in as `data-settings-key` (Header)
- **Used by**: `BaseLayout.astro` (Header, Footer, banners, CookieConsent globally); `register.astro`, `contact.astro`, `check-in.astro` (IntakeForm); `IntakeForm.astro` (ClassCalendarPicker)

## Architecture

`IntakeForm` is the shared skeleton for every "collect visitor info" flow (registration, contact, check-in); pages differentiate behavior purely through props rather than separate form components, so changes to shared field markup/validation belong here rather than being duplicated per page.
