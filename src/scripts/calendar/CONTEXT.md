# src/scripts/calendar Context

> Tier 3 — referenced from [docs-overview.md](../../../docs/ai-context/docs-overview.md). The browser script of `/calendar` (`src/pages/calendar.astro`), split by job.

## How it starts

`calendar.astro`'s `<script>` imports the public modules and starts them in the order the page always set itself up (list view, hover cards, view switch, grid clicks, banner fitting, then the admin check). `adminGate.ts` checks for an admin session and only then loads `editor/` with a dynamic `import()`, so public visitors never download the editor. The editor wires every control (`editor/start.ts`, same order as before) before it shows the Add button or the details panel's Edit, so those work as soon as they appear.

State lives in two objects rather than scattered `let`s (a module can't assign another module's variable): `state.ts` (`shared`: what both sides use) and `editor/state.ts` (`editor`: the editor's own). Modules only declare at load (functions, constants, element lookups); listeners are added by their `init*()` functions. Dates go through `src/lib/siteTime.ts` like everywhere else; a class's own date, day and times through `src/lib/eventClock.ts`, in its own zone (`time_zone`, migration 0076), with its zone after the time only when its clock differs from the site's.

## Public (every visitor)

| File | Job |
| --- | --- |
| `types.ts` | `SiteEvent`: an event as the page has it (public copy with spots labels, or the admin feed with capacities), with its `time_zone`, `city` and `state` |
| `state.ts` | `shared`: admin mode on, the event in the details panel, the editor's "add on this day" hook |
| `format.ts` | Price lines (early bird / flash sale), spots text, HTML escaping (times and dates: `lib/eventClock.ts`) |
| `views.ts` | Calendar / List switch (remembered in `localStorage` `bwb-calendar-view`) and the list's Read more links |
| `tooltips.ts` | A banner's hover card: placed inside the window, kept out of the tab order |
| `detailPanel.ts` | The details panel beside the grid (Register, flyer, location with "· City" when the class is away from the home city, which the server writes onto `#detail-location` as `data-home-city`/`data-home-state`; the admin buttons for admins) |
| `monthGrid.ts` | Banners drawn in the browser, a phone's day of dots opened into a row, the redraw with the admin copy of the events (each on its own zone's day, `eventDayKey`, as the server bucketed it) |
| `bannerFit.ts` | One font size for every banner title, the largest at which they all fit (again on resize and when the web font loads) |
| `calendarClicks.ts` | Delegated clicks and Enter/Space on banners, dots and (admins) a day's empty space |
| `adminGate.ts` | Admin session check, then loads and starts `editor/` |

## Admin editor (`editor/`, loaded only for admins)

| File | Job |
| --- | --- |
| `start.ts` | Wires the editor (rich-text keys, every control) and reveals the admin controls; loads the admin copy of the events |
| `state.ts` | `editor`: the open class/event, type, color, repeat days, tabs and their drafts, pending flyer, save in progress |
| `dom.ts` | The editor's fields and controls (markup: `src/components/EventEditorModal.astro`) |
| `dates.ts` | Date/time fields to and from instants: the class's in the editor's picked zone, the deal-end fields in the site zone |
| `timeZone.ts` | The Schedule section's time zone: "Different time zone" opens the picker (already open on a class in another zone), the hint names the zone; `editorZone()` is what a save reads the typed date and times in |
| `api.ts` | The admin's auth header, delete, the "Syncing…" indicator |
| `places.ts` | Location suggestions from Google Places (loaded with Google's `importLibrary` bootstrap; see the comment there; asks for `address_components`), plain text when unavailable |
| `place.ts` | The venue's city and state (`events.city`/`state`, migration 0077), kept in `editor.place` beside the Location field (no field of their own): a Places pick sets them (`placeCityState`: locality, else postal town, else sublocality/level 3; state's short name), opening a class loads its own, and a save sends them (`editorPlace`) only while the Location still reads as when they were found, so typing a location by hand (or any change in the plain-text fallback) clears them. Tab drafts keep them |
| `fieldRender.ts` | Redraws fields from state: class vs event pricing columns and capacity, colors, repeat days, overview, series date lock |
| `modal.ts` | Opens the editor on a class, event or new one; closes it (asking about unsaved tabs); "New linked class" |
| `sections.ts` | Section menu and scroll-spy, each section's summary, status chips, series banner |
| `images.ts` | Homepage image: crop, then upload |
| `flyer.ts` | Flyer: scale down, upload, the "Also used by" note for linked classes |
| `controls.ts` | Type, color, rich-text, repeat and delete buttons; the details panel's Edit and Delete |
| `saveRequest.ts` | What a Save sends (create or update, series rebuild, link to a series), with `timeZone`; a series whose zone changed is rebuilt so every class moves |
| `save.ts` | Save and Save all, one at a time, and the dialogs and reload after |
| `tabs.ts` | One tab per linked class, each keeping its draft; refreshing the admin copy after a save |
| `linked.ts` | The Linked Classes/Events section (`src/lib/linkedClassesEditor.ts`) wired to the editor |
