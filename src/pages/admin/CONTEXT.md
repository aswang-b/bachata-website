# src/pages/admin Context

> Tier 3 — referenced from [docs-overview.md](../../../docs/ai-context/docs-overview.md). Secondary admin pages, linked from the main dashboard at `src/pages/admin.astro` (a sibling file, not in this directory).

## Purpose

Each file is a standalone Astro page gated by `requireAdmin`-style client checks, heavy on inline `<script>` (no framework components in this project — see [components CONTEXT.md](../../components/CONTEXT.md)). All fetch their data from the matching route under [`src/pages/api/admin/`](../api/admin/CONTEXT.md).

## Key Files

| File | Purpose |
| --- | --- |
| `analytics.astro` | "Data & Analytics" page (`/admin/analytics`), linked from `admin.astro`. Sortable/filterable tables for Sign-Ups (Drop-Ins show their chosen class date, editable per registration), Check-Ins, and Attendance (matches + orphan workqueue), the last driven client-side by `attendanceMatching.ts`'s matching over data from `attendance-data.ts`; Check-Ins/Attendance tables can be narrowed to a specific series occurrence date, not just a class title. Large file (~1,850 lines) — mostly inline table-rendering/sort/filter script |
| `checkin-qr.astro` | Displays a QR code (from `generate-checkin-qr.ts`) admins can print/display at a class for self-service check-in |
| `inbox.astro` | Contact-form submission inbox (`inbox-data.ts`), marks-as-seen backing the unread badge in `Header.astro` (`unseen-count.ts`) |

## Integration Points

- **Depends on**: `src/pages/api/admin/*` (all data), `src/lib/attendanceMatching.ts` and `src/lib/classSeries.ts` (client-side matching/occurrence logic in `analytics.astro`)
- **Used by**: linked from `src/pages/admin.astro`'s header and from `src/components/Header.astro`'s admin nav

## Architecture

Every page here links back to `/admin` (the main dashboard) rather than nesting a shared admin layout — navigation is a manual back-link, not a route-group layout.
