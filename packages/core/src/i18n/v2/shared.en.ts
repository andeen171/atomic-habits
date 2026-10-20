/**
 * v2 strings shared by several areas (spec §7). Owner: F.
 * Spread into `en.ts`; every key also lives in `shared.pt-BR.ts`.
 */
export const sharedEn = {
	"nav.journal": "Journal",
	"nav.account": "Account",

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

	// List formatting (`formatList`): two items, then the last of three or more.
	"list.and.pair": "{first} and {second}",
	"list.and.last": "{rest}, and {last}",
	"list.or.pair": "{first} or {second}",
	"list.or.last": "{rest}, or {last}",
} as const;
