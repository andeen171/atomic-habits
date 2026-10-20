/**
 * v2 strings for cloud (account.*, plan.*, ai.*, content.*, complete.*, sync.*) (spec §7). Owner: T5. Copy source: Annex C §7 and spec §7.
 * Spread into `en.ts`; every key also lives in `cloud.pt-BR.ts`.
 */
export const cloudEn = {
	// Persistence (spec §2.6.5): blocking banner when a local write fails (F, Phase 1A).
	"sync.persistError": "Atomic couldn't save on this device. Export a backup now.",
	// Sync protocol v2 (spec §2.7): superseded documents, rejections, sync quota (F, Phase 1A).
	"sync.superseded": "Edited on a newer version of Atomic — update to edit this.",
	"sync.supersededCount.one": "{count} item needs a newer version",
	"sync.supersededCount.other": "{count} items need a newer version",
	"sync.rejectedCount.one": "{count} change couldn't be saved on the server",
	"sync.rejectedCount.other": "{count} changes couldn't be saved on the server",
	"sync.quotaFull": "Sync storage is full. New changes stay on this device.",
	// Device-local "Sync journal" switch (D19; F, Phase 1A).
	"sync.journal": "Sync journal",
	"sync.journalHint":
		"Off: entries written on this device stay on it. Entries from your other devices still arrive.",
} as const;
