/**
 * Monthly goal wins (Annex H §1.1.4): on a local commit that crosses a
 * month's goal, a success toast, `ui.celebrate()` when celebrations are on
 * and `haptics.success()`, once per habit and month (`claimMonthWin`).
 * Remote and derived commits never celebrate (D56). Mounted once in
 * `app/_layout.tsx`. Owner: T1. Phase 1B stub: does nothing.
 */
export function useMonthCelebration(): void {}
