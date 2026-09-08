# CLAUDE.md

> **Tier 1 documentation** — see [docs/ai-context/project-structure.md](docs/ai-context/project-structure.md) for tech stack and file tree, and [docs/ai-context/docs-overview.md](docs/ai-context/docs-overview.md) for the full documentation map.

## Architecture

Astro 7 (SSR via `@astrojs/netlify`) + Tailwind CSS 4 + Supabase, hosted on Netlify. Public marketing/registration/check-in pages plus an admin area (`/admin/*`, `/api/admin/*`) for managing class events, signups, check-ins, Google Calendar sync, and site settings. Full stack details and file tree: [project-structure.md](docs/ai-context/project-structure.md).

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
