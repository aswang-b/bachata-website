# Documentation Overview

> Tier 1 (Entry Point) — referenced from [CLAUDE.md](../../CLAUDE.md). See [project-structure.md](project-structure.md) for tech stack and file tree.

## Tier Map

| Tier | Scope | Files | Update when |
| --- | --- | --- | --- |
| 1 — Entry Points | Whole project | `CLAUDE.md`, `docs/ai-context/project-structure.md`, `docs/ai-context/docs-overview.md` (this file) | Architecture, tech stack, or top-level structure changes |
| 2 — Component | A directory under `src/` (e.g. `src/lib/`, `src/components/`) | `CONTEXT.md` in that directory | Files added/removed or patterns change within the component |
| 3 — Feature | A feature subdirectory (e.g. `src/pages/admin/`, `src/pages/api/admin/`) | `CONTEXT.md` in that directory | Implementation details of that feature change |

Tier 2 exists for `src/lib/` and `src/components/`. No Tier 3 `CONTEXT.md` files exist yet (e.g. `src/pages/admin/`, `src/pages/api/admin/`) — add them as those feature areas are worked on.

## Where Things Live

- **Astro/dev-server conventions, background dev server usage**: `CLAUDE.md`
- **Tech stack, commands, full file tree, domain overview**: `project-structure.md`
- **Contributor-facing quick start (generic Astro template)**: `README.md`
- **Database schema history**: `supabase/migrations/*.sql`
- **Netlify build/function config**: `netlify.toml`, `netlify/functions/`

## Cross-Reference Rule

`CLAUDE.md` must link both other Tier 1 files at the top. Tier 2/3 `CONTEXT.md` files should link back to this file rather than duplicating the tier map.
