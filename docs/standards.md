# Standards

## Code
- **Biome** formats and lints everything (`bun check`); tabs, double quotes, 100 columns.
- Strict TypeScript, no `any`. Validate untrusted data (imports, sync, API input) with the Zod
  schemas from `@atomic/core`.
- Logic that must behave the same on web and native lives in `packages/core` with tests. Apps
  contain UI and platform glue only.
- Never hard-code user-facing strings: use `useT()` (`t()` / `tp()` for core keys). App-specific
  strings go in the app's `lib/messages.ts` with both `en` and `pt-BR`, read with `at()` on the
  web and `x()` on native.
- Never hard-code colors: use the tokens from `@atomic/core/theme` (CSS variables on web, theme
  context on native).
- zustand selectors return stable references; derive collections with `useMemo` or core hooks.
- Dates are local day keys (`toDayKey`, `addDays`, …); no `toISOString().split("T")`.

## UX
Follow [design.md](design.md): optimistic local writes, undo instead of confirm for reversible
actions, accessible names on icon controls, keyboard support on web, reduced motion respected,
both themes and both languages checked.

## Testing
- `cd packages/core && bun test` — habit science, store, sync engine, HTTP client.
- `cd apps/server && bun test` — auth, sync API, end-to-end through the core client.
- UI changes: build and drive the app with Playwright (Chromium is preinstalled in cloud
  sessions), screenshot light/dark, desktop/mobile, en/pt-BR.

## Git
Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`). Husky runs Biome on staged
files.
