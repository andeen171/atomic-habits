/**
 * v2 strings for habits (month.*, levelUp.*, blueprint.*, …) (spec §7). Owner: T1. Copy source: Annex H §7 and spec §7.
 * Spread into `en.ts`; every key also lives in `habits.pt-BR.ts`.
 */
export const habitsEn = {
	// Blueprint slot concepts (spec §5.3, D14): subtitle of a filled slot, title of an empty one.
	"blueprint.concept.cueTime": "Implementation intention · when",
	"blueprint.concept.cueLocation": "Implementation intention · where",
	"blueprint.concept.stackAfter": "Habit stacking",
	"blueprint.concept.environment": "Environment design",
	"blueprint.concept.bundle": "Temptation bundling",
	"blueprint.concept.why": "Reframe: “I get to”",
	"blueprint.concept.twoMinute": "Two-minute rule",
	"blueprint.concept.reward": "Immediate reward",
	"blueprint.concept.break.cueLocation": "Pointing-and-calling",
	"blueprint.concept.break.environment": "Reduce exposure",
	"blueprint.concept.break.bundle": "Reframe the benefits",
	"blueprint.concept.break.twoMinute": "Increase friction",
	"blueprint.concept.break.reward": "Habit contract",

	// Blueprint slot hints, value formats and the time placeholder (Annex H §1.3, §7).
	"blueprint.slot.cueTimeHint": "Decide exactly when. Vague plans fail.",
	"blueprint.slot.cueLocationHint": "Decide exactly where it happens.",
	"blueprint.slot.environmentHint": "Make the cue impossible to miss.",
	"blueprint.slot.whyHint": "Swap “I have to” for “I get to”.",
	"blueprint.slot.twoMinuteHint": "Scale it down until it takes two minutes.",
	"blueprint.slot.triggerHint": "What sets it off? Name the cue.",
	"blueprint.slot.invisibleHint": "Remove the cue from your environment.",
	"blueprint.slot.costHint": "Reframe it: what does it really cost you?",
	"blueprint.slot.frictionHint": "Add steps between you and the habit.",
	"blueprint.slot.accountabilityHint": "Make it painful: a habit contract or a friend watching.",
	"blueprint.slot.cueTimeValue": "At {time}",
	"blueprint.slot.stackAfterValue": "After I {stack}",
	"blueprint.slot.whyValue": "I get to {why}",
	"blueprint.slot.cueTimePlaceholder": "e.g. 21:30",
} as const;
