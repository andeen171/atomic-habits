# Agent prompt: Atomic monorepo

You are working on **Atomic**, a local-first habit and task app inspired by *Atomic Habits*. Read
`docs/design.md` (product & design spec), `docs/monorepo.md` (architecture) and
`docs/standards.md` before changing code.

## Where things go
- Habit science, data model, copy, tokens, sync → `packages/core` (with `bun test` coverage).
- Web/desktop UI → `apps/web`; mobile UI → `apps/native`; sync API → `apps/server`.
- A feature usually touches core first, then both clients so they stay at parity.

## Definition of done
1. `bun check` (Biome) and `bun check-types` pass.
2. Core/server tests pass (`bun run test`).
3. UI verified visually in light/dark, desktop/mobile, en/pt-BR.
4. No hard-coded strings or colors; strings exist in both locales.
