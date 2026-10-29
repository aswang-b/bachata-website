# src/components Context

> Tier 2 — referenced from [docs-overview.md](../../docs/ai-context/docs-overview.md). Shared Astro components used across public pages.

## Purpose

Reusable UI pieces included by pages in `src/pages/`. All are `.astro` components; interactivity (where present) is plain DOM script in an inline `<script>` block, not a framework component — this project has no React/Vue/Svelte components.

## Key Files

| File | Purpose |
| --- | --- |
| `Header.astro` | Sticky site nav; nav items can be hidden per `siteSettings` keys (`hide_about_nav`, etc.); highlights the admin page differently. The Register for Classes / Events buttons stay in the header row at every width (switching to short "Classes"/"Events" labels when space runs out), so the phone menu doesn't repeat them |
| `Footer.astro` | Site footer with social links |
| `AnnouncementBanner.astro` | Fetches `/api/banner` and shows the site-wide banner (pink-to-red, ~5:1 with its white text), stuck to the top with the nav header in `BaseLayout`'s `#site-top` wrapper. Closing it hides it for the current page only; it's back on the next load |
| `PreviewBanner.astro` | Shown when an admin is previewing the site as a public visitor (`lib/previewMode.ts`); lets them exit preview |
| `CookieConsent.astro` | Cookie consent bar, links to `/privacy-policy` |
| `DanceHighlights.astro` | Auto-discovers images in `src/assets/highlights/*` via `import.meta.glob` and renders an autoplaying slideshow — no code changes needed to add/remove photos |
| `ClassCalendarPicker.astro` | Month-grid class picker (colored by `lib/eventColors.ts`, so picked custom colors show; days and times in the site time zone via `siteTime.ts`). Used by `IntakeForm` only when `classEvents` is passed, which no page does right now (`events`, `required`, `emptyMessage` props); on selection writes both the legacy display string (`class`) and the structured `class_selections` JSON (`{ key, title, label, mode }`, series-id-keyed) that `classRegistrations.resolveClassSelections` reads |
| `RegistrationForm.astro` | The whole public sign-up page for `/register` (`kind="class"`) and `/register/events` (`kind="event"`): pick one or more classes/events, up to 5 dancers, subtotal, cash/Venmo. Events sell one ticket price (no Whole Series / Drop In), skip the Leader/Follower role, and only ask for payment when the subtotal is above $0. Full or closed entries can't be picked; spots show where the class/event allows it, per role for classes capped by Leader/Follower (a full role blocks a dancer in that role before submitting). Events with community guidelines show them in a scroll box above the subtotal with a required agreement checkbox. A blocked submit scrolls to the first problem (a missing dancer detail focuses that dancer's empty field). Bundle deals (`lib/deals.ts`) show as discount lines in the subtotal, and a class that would complete a deal is offered under it with an Add button. Linked classes (linkRules.ts): a pick another pick includes stays picked on its card (it can be unpicked like any other) but is folded into that pick: listed as included at $0, not charged or sent, and counted as its own pick again once nothing covers it; "cannot take both" pairs get an amber note with a Remove button |
| `ErrorsQueue.astro` | Dashboard → Errors tab (rightmost, with an open-count badge): one line per open error with its time, count and Dismiss; a bounced email lists the sign-ups using it, each with an email field, Update email and Resend confirmation (`/api/admin/site-errors`) |
| `SiteTimeZoneSetting.astro` | Admin → Admin → Site Time Zone (`/api/admin/time-zone`) |
| `DealsAdmin.astro` | Admin → Deals tab (included by `admin.astro`, loads on first open): list, create, edit, pause and delete bundle deals via `/api/admin/deals`, picking from upcoming public classes/events (classes or events, never both), with a live summary ("Both for $40 (they're $50 today)"). Each deal is labeled Live, Paused, Scheduled, Ended or Can't apply (fewer of its classes left than it needs, or it mixes classes and events), live ones first. A picked Starts/Ends day is a whole day in the site zone: `zonedToInstant(day)` to `zonedToInstant(addDaysToKey(day, 1))` |
| `FlyerDialog.astro` | The full-size flyer viewer on the homepage and calendar: any element with `data-flyer-open="<url>"` opens it (delegated, so the calendar's script-filled detail panel works too); `data-flyer-alt` describes it, else the image inside |
| `GalleryFlyersAdmin.astro` | Admin → Homepage: the hand-uploaded flyers of the homepage's "Past Classes & Events" gallery (upload several at once, uncropped and scaled to ≤2000px; reorder; remove), each change saved at once via `/api/admin/gallery-flyers` |
| `PastFlyersGallery.astro` | The homepage's "Past Classes & Events" row: those flyers scroll sideways and turn like a cylinder (the middle one faces you; the rest turn away, drop back and fade), arrows on desktop, free swiping on phones (with a "Swipe to see more" hint until the first swipe, remembered in this browser), full size via the homepage's flyer dialog; hidden while empty |
| `IntakeForm.astro` | Shared registration/contact form; wraps `ClassCalendarPicker` when `classEvents` are supplied; configurable via props (`registrationType`, `heading`, `commentsLabel`, `contactMethodPicker`, etc.) for reuse across register/contact/check-in-style flows |

## Integration Points

- **Depends on**: `src/lib/previewMode.ts` (PreviewBanner), `/api/banner` (AnnouncementBanner), `src/assets/highlights/` (DanceHighlights), `src/lib/siteSettings.ts` read while the page renders, so the header arrives whole with no buttons popping in after load (Header)
- **Used by**: `BaseLayout.astro` (Header, Footer, banners, CookieConsent globally); `register.astro`, `contact.astro`, `check-in.astro` (IntakeForm); `IntakeForm.astro` (ClassCalendarPicker)

## Architecture

`IntakeForm` is the shared skeleton for every "collect visitor info" flow (registration, contact, check-in); pages differentiate behavior purely through props rather than separate form components, so changes to shared field markup/validation belong here rather than being duplicated per page.
