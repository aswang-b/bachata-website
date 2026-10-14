# src/pages/admin Context

> Tier 3 — referenced from [docs-overview.md](../../../docs/ai-context/docs-overview.md). Secondary admin pages, linked from the main dashboard at `src/pages/admin.astro` (a sibling file, not in this directory).

## Purpose

Each file is a standalone Astro page gated by `requireAdmin`-style client checks, heavy on inline `<script>` (no framework components in this project — see [components CONTEXT.md](../../components/CONTEXT.md)). All fetch their data from the matching route under [`src/pages/api/admin/`](../api/admin/CONTEXT.md).

## Key Files

| File | Purpose |
| --- | --- |
| `analytics.astro` | "Dashboard" page (`/admin/analytics`, titled "Dancer Dashboard"), linked from `admin.astro`. Sortable/filterable tables for Sign-Ups (Drop-Ins show their chosen class date, editable per registration), Event Registration (event sign-ups only, kept out of Sign-Ups and Attendance since nobody checks in to events; Paid checkbox, edit (dancer details, payment, or switching events) and delete to the Recycling Bin, all under its own edit lock), Check-Ins, and Attendance (matches + orphan workqueue; orphaned check-ins can be linked to a class date), the last driven client-side by `attendanceMatching.ts`'s matching over data from `attendance-data.ts`; Each tab's "Filter by class" takes several [class] [date] rows (`classFilterGroup.ts`, "+" adds a row) and shows rows matching any of them. The Recycling Bin marks auto-detected duplicate submissions with a "Duplicate" badge. Large file (~1,850 lines) — mostly inline table-rendering/sort/filter script |
| `checkin-qr.astro` | Displays a QR code (from `generate-checkin-qr.ts`) admins can print/display at a class for self-service check-in. Multi-select: one class/date makes the usual per-class link; two or more make one QR whose check-in page (`/check-in?events=…`) lets dancers pick which they're here for. Optional "also register attendees as drop-ins" |
| `inbox.astro` | Contact-form submission inbox (`inbox-data.ts`), marks-as-seen backing the unread badge in `Header.astro` (`unseen-count.ts`) |

## Integration Points

- **Depends on**: `src/pages/api/admin/*` (all data), `src/lib/attendanceMatching.ts` and `src/lib/classSeries.ts` (client-side matching/occurrence logic in `analytics.astro`)
- **Used by**: linked from `src/pages/admin.astro`'s header and from `src/components/Header.astro`'s admin nav

## Architecture

Every page here links back to `/admin` (the main dashboard) rather than nesting a shared admin layout — navigation is a manual back-link, not a route-group layout.
