/**
 * v2 strings for trackers (tracker.*, duration.*) (spec §7). Owner: T4. Copy source: Annex K §7 and spec §7.
 * Spread into `en.ts`; every key also lives in `trackers.pt-BR.ts`.
 */
export const trackersEn = {
	// Durations (`formatDuration` in i18n/index.ts, spec §3.1): "1 h 05 min", "4 min 30 s".
	"duration.hm": "{h} h {m} min",
	"duration.m": "{m} min",
	"duration.ms": "{m} min {s} s",
	"duration.s": "{s} s",
} as const;
