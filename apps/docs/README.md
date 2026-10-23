# Atomic documentation (`apps/docs`)

Astro Starlight site for Atomic, deployed at https://atomic-habits-docs.vercel.app.

- English pages: `src/content/docs/`
- Brazilian Portuguese pages: `src/content/docs/pt-br/` (same file names)
- Sidebar and locales: `astro.config.mjs`
- Brand colors: `src/styles/theme.css`

| Command | What it does |
| --- | --- |
| `bun dev` | Local preview on http://localhost:4321 |
| `bun run build` | Static build to `dist/` |
| `bun run preview` | Serve the built site |

The **Guides** section (`src/content/docs/guides/`) is for people using Atomic (getting started,
the method, the journal, trackers, account and sync, self-hosting); **Reference** holds the
architecture, the backup format and the privacy page. The **Development** section
(`src/content/docs/development/`) is the guide to the codebase: start with the review guide, which
walks through the v2 changes request by request.

Every page exists in English and in Portuguese with the same file name. Internal links are
absolute and include the locale prefix for Portuguese (`/pt-br/guides/journal/`).
