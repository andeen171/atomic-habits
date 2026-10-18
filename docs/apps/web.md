# Web & desktop (`apps/web`)

React 19 + Vite 7 + TanStack Router + Tailwind v4. The same build runs as a website, an installable
PWA, a Tauri desktop app and a single-file claude.ai Artifact.

## Structure
- `src/routes/` — file routes. `_app.*` routes share the app shell (sidebar ≥1024px, icon rail
  768–1023px, bottom tabs <768px); `onboarding` and the habit editor are full-screen.
- `src/components/` — `ui/` primitives, `habit/` (ring, row, heatmap, calendar, blueprint),
  `today/`, `editor/`, `tasks/`, `identity/`, `insights/` (hand-built SVG charts), `settings/`,
  `layout/`, `dialogs/` (command palette, shortcuts).
- `src/lib/` — store, sync controller, theme provider, shortcuts, messages, PWA registration,
  Artifact integration (`artifact-cloud.ts`, `runtime.ts`).
- `plugins/atomic-tokens.ts` — Vite plugin turning core design tokens into CSS variables.
- `src-tauri/` — Tauri 2 shell (window defaults, icons).

## Commands
| Command | |
| --- | --- |
| `bun dev` | Vite dev server on :3001 |
| `bun run build` | `dist/` (PWA, also Tauri's frontend) |
| `bun run build:artifact` | `dist-artifact/index.html` (standalone) and `atomic.html` (Artifact page body) |
| `bun desktop:dev` / `bun desktop:build` | Tauri (requires Rust) |
| `bun check-types` | TypeScript |

## Notes
- Hash history everywhere except the Artifact build, which routes in memory.
- The theme follows `settings.theme`, then a host `data-theme` attribute, then the OS.
- In the Artifact build each viewer's data is mirrored to their private `db` subtree and backups
  are offered through the viewer's download prompt.
