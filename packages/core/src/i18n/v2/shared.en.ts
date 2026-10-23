/**
 * v2 strings shared by several areas (spec §7). Owner: F.
 * Spread into `en.ts`; every key also lives in `shared.pt-BR.ts`.
 */
export const sharedEn = {
	"nav.journal": "Journal",
	"nav.account": "Account",
	// A nav item's accessible name when it carries a count badge ("Tasks, 8 to do").
	"nav.withCount": "{label}, {count} to do",

	// The book's five cues (CUE_TYPES), shared by the journal and the slip tracker.
	"cue.time": "A time of day",
	"cue.location": "A place",
	"cue.event": "Something I'd just done",
	"cue.emotion": "A feeling",
	"cue.people": "Other people",

	"tracker.unit.pages.one": "{count} page",
	"tracker.unit.pages.other": "{count} pages",
	"tracker.unit.words.one": "{count} word",
	"tracker.unit.words.other": "{count} words",
	"tracker.unit.minutes.one": "{count} min",
	"tracker.unit.minutes.other": "{count} min",
	"tracker.unit.sessions.one": "{count} session",
	"tracker.unit.sessions.other": "{count} sessions",

	"create.journalEntry": "Journal entry",
	"create.journalHint": "Evidence, a comeback plan, a review…",

	"app.newVersion": "A new version is ready",
	"app.reload": "Reload",
	// Placeholder screens of the Phase 1B scaffold (native journal, timer, writing pad).
	"app.comingSoon": "Coming soon",
	"app.comingSoonBody": "This part of Atomic is still being built.",

	// The artifact build's own cloud copy refused a write (spec §2.10; F, Phase 1B web scaffold).
	// Listed under cloud.* in spec §7, defined here so T5's catalog must not add it again.
	"sync.cloudPaused": "Cloud saving paused — export a backup to keep your latest changes.",

	// List formatting (`formatList`): two items, then the last of three or more.
	"list.and.pair": "{first} and {second}",
	"list.and.last": "{rest}, and {last}",
	"list.or.pair": "{first} or {second}",
	"list.or.last": "{rest}, or {last}",
} as const;
