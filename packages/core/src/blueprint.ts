import { type Weekday, orderedWeekdays } from "./dates";
import { type MessageKey, type PluralKey, type Translator, inSentence } from "./i18n";
import { type Habit, type HabitKind, type Identity, timeSchema } from "./model";
import type { HabitPatch } from "./store";
import { knownTracker, trackerUnitKind } from "./trackers/meta";

export interface BlueprintLine {
	/** Law of behavior change (1 obvious, 2 attractive, 3 easy, 4 satisfying). */
	law: 1 | 2 | 3 | 4;
	text: string;
}

/**
 * Human sentences that describe a habit's plan — the implementation
 * intention, habit stack, two-minute version, bundle and reward (or their
 * inversions for habits being broken).
 */
export function blueprintLines(habit: Habit, t: Translator): BlueprintLine[] {
	const name = inSentence(habit.name);
	const lines: BlueprintLine[] = [];
	const add = (law: BlueprintLine["law"], text: string) => lines.push({ law, text });

	if (habit.kind === "break") {
		const trigger = habit.cueLocation ?? habit.stackAfter;
		if (trigger) add(1, t.t("blueprint.trigger", { trigger }));
		if (habit.environment) add(1, t.t("blueprint.invisible", { environment: habit.environment }));
		if (habit.bundle) add(2, t.t("blueprint.unattractive", { bundle: habit.bundle }));
		if (habit.twoMinute) add(3, t.t("blueprint.difficult", { twoMinute: habit.twoMinute }));
		if (habit.reward) add(4, t.t("blueprint.unsatisfying", { reward: habit.reward }));
		return lines;
	}

	if (habit.cueTime && habit.cueLocation) {
		add(
			1,
			t.t("blueprint.intention", { habit: name, time: habit.cueTime, location: habit.cueLocation }),
		);
	} else if (habit.cueTime) {
		add(1, t.t("blueprint.intentionTime", { habit: name, time: habit.cueTime }));
	} else if (habit.cueLocation) {
		add(1, t.t("blueprint.intentionLocation", { habit: name, location: habit.cueLocation }));
	}
	if (habit.stackAfter) {
		add(1, t.t("blueprint.stack", { stack: inSentence(habit.stackAfter), habit: name }));
	}
	if (habit.environment) add(1, t.t("blueprint.environment", { environment: habit.environment }));
	if (habit.bundle)
		add(2, t.t("blueprint.bundle", { habit: name, bundle: inSentence(habit.bundle) }));
	if (habit.why) add(2, t.t("blueprint.why", { why: inSentence(withoutGetTo(habit.why)) }));
	if (habit.twoMinute) add(3, t.t("blueprint.twoMinute", { twoMinute: habit.twoMinute }));
	if (habit.reward) add(4, t.t("blueprint.reward", { reward: habit.reward }));
	return lines;
}

/** "I get to read" typed into the field shouldn't read "I get to I get to read". */
function withoutGetTo(value: string): string {
	return value.replace(/^\s*(i get to|eu tenho a oportunidade de)\s+/i, "");
}

export function identityLine(identity: Identity | undefined, t: Translator): string | null {
	if (!identity) return null;
	return t.t("blueprint.identity", { identity: identity.statement.trim() });
}

/** "Every day", "Mon · Wed · Fri", "3 times a week". */
export function scheduleLabel(habit: Habit, t: Translator, weekStartsOn: Weekday = 1): string {
	const { schedule } = habit;
	if (schedule.type === "daily") return t.t("form.schedule.daily");
	if (schedule.type === "weekly") return t.tp("form.schedule.timesPerWeek", schedule.times);
	if (schedule.days.length === 7) return t.t("form.schedule.daily");
	return orderedWeekdays(weekStartsOn)
		.filter((d) => schedule.days.includes(d))
		.map((d) => t.weekdayName(d, "short"))
		.join(" · ");
}

/**
 * "3/8 glasses" style progress label. Units of an enabled tracker come from
 * the catalog ("14/10 pages", relabelled when the language changes); the
 * measure tracker's own unit, plain habits and habits whose tracker was
 * switched off ("Switch to simple check-off", Annex K §1.5) use `habit.unit`.
 */
export function progressLabel(habit: Habit, count: number, t: Translator): string {
	const enabled = knownTracker(habit)?.enabled !== false;
	const kind = enabled ? trackerUnitKind(habit) : null;
	if (kind && kind !== "value") {
		return t.t("habit.progress", {
			count,
			target: t.tp(`tracker.unit.${kind}` as PluralKey, habit.target),
		});
	}
	return habit.unit
		? t.t("habit.progressUnit", { count, target: habit.target, unit: habit.unit })
		: t.t("habit.progress", { count, target: habit.target });
}

/** Streak label respecting the habit type ("12 day streak", "3 weeks", "40 days clean"). */
export function streakLabel(
	habit: Habit,
	streak: { current: number; unit: "days" | "weeks" },
	t: Translator,
): string {
	if (habit.kind === "break") return t.tp("streak.clean", streak.current);
	return streak.unit === "weeks"
		? t.tp("streak.weeks", streak.current)
		: t.tp("streak.days", streak.current);
}

/**
 * The strength stat's label: "Strength" for build habits and "Freedom" for
 * break habits (D61), on cards and Insights (`short`) or on habit detail with
 * its hint (`detail`).
 */
export function strengthLabel(
	habit: Pick<Habit, "kind">,
	t: Translator,
	variant: "short" | "detail" = "short",
): { label: string; hint: string | null } {
	const free = habit.kind === "break";
	if (variant === "short") {
		return { label: t.t(free ? "habits.freedom" : "habits.strength"), hint: null };
	}
	return free
		? { label: t.t("detail.freedom"), hint: t.t("detail.freedomHint") }
		: { label: t.t("detail.strength"), hint: t.t("detail.strengthHint") };
}

// ── Blueprint board (Annex H §1.3 + §3.3, concepts per spec §5.3 / D14) ──

export const BLUEPRINT_FIELDS = [
	"cueTime",
	"cueLocation",
	"stackAfter",
	"environment",
	"bundle",
	"why",
	"twoMinute",
	"reward",
] as const;
export type BlueprintField = (typeof BLUEPRINT_FIELDS)[number];
export type BlueprintLaw = 1 | 2 | 3 | 4;

export interface BlueprintSlot {
	field: BlueprintField;
	law: BlueprintLaw;
	/** The user's text; null when empty. Break triggers read `cueLocation ?? stackAfter`. */
	value: string | null;
	/** The book concept: the subtitle of a filled slot, the title of an empty one. */
	concept: MessageKey;
	hint: MessageKey;
	placeholder: MessageKey;
	input: "time" | "text" | "multiline";
	maxLength: number;
}

type SlotSpec = Omit<BlueprintSlot, "value">;

const BUILD_SLOTS: readonly SlotSpec[] = [
	{
		field: "cueTime",
		law: 1,
		concept: "blueprint.concept.cueTime",
		hint: "blueprint.slot.cueTimeHint",
		placeholder: "blueprint.slot.cueTimePlaceholder",
		input: "time",
		maxLength: 5,
	},
	{
		field: "cueLocation",
		law: 1,
		concept: "blueprint.concept.cueLocation",
		hint: "blueprint.slot.cueLocationHint",
		placeholder: "form.cueLocationPlaceholder",
		input: "text",
		maxLength: 120,
	},
	{
		field: "stackAfter",
		law: 1,
		concept: "blueprint.concept.stackAfter",
		hint: "form.stackAfterHint",
		placeholder: "form.stackAfterPlaceholder",
		input: "text",
		maxLength: 160,
	},
	{
		field: "environment",
		law: 1,
		concept: "blueprint.concept.environment",
		hint: "blueprint.slot.environmentHint",
		placeholder: "form.environmentPlaceholder",
		input: "multiline",
		maxLength: 280,
	},
	{
		field: "bundle",
		law: 2,
		concept: "blueprint.concept.bundle",
		hint: "form.bundleHint",
		placeholder: "form.bundlePlaceholder",
		input: "text",
		maxLength: 160,
	},
	{
		field: "why",
		law: 2,
		concept: "blueprint.concept.why",
		hint: "blueprint.slot.whyHint",
		placeholder: "form.whyPlaceholder",
		input: "multiline",
		maxLength: 280,
	},
	{
		field: "twoMinute",
		law: 3,
		concept: "blueprint.concept.twoMinute",
		hint: "blueprint.slot.twoMinuteHint",
		placeholder: "form.twoMinutePlaceholder",
		input: "text",
		maxLength: 160,
	},
	{
		field: "reward",
		law: 4,
		concept: "blueprint.concept.reward",
		hint: "form.rewardHint",
		placeholder: "form.rewardPlaceholder",
		input: "text",
		maxLength: 160,
	},
];

/** Break habits: five slots with the inverse laws' concepts (never the column header's words). */
const BREAK_SLOTS: readonly SlotSpec[] = [
	{
		field: "cueLocation",
		law: 1,
		concept: "blueprint.concept.break.cueLocation",
		hint: "blueprint.slot.triggerHint",
		placeholder: "form.triggerPlaceholder",
		input: "text",
		maxLength: 120,
	},
	{
		field: "environment",
		law: 1,
		concept: "blueprint.concept.break.environment",
		hint: "blueprint.slot.invisibleHint",
		placeholder: "form.invisiblePlaceholder",
		input: "multiline",
		maxLength: 280,
	},
	{
		field: "bundle",
		law: 2,
		concept: "blueprint.concept.break.bundle",
		hint: "blueprint.slot.costHint",
		placeholder: "form.unattractivePlaceholder",
		input: "text",
		maxLength: 160,
	},
	{
		field: "twoMinute",
		law: 3,
		concept: "blueprint.concept.break.twoMinute",
		hint: "blueprint.slot.frictionHint",
		placeholder: "form.difficultPlaceholder",
		input: "text",
		maxLength: 160,
	},
	{
		field: "reward",
		law: 4,
		concept: "blueprint.concept.break.reward",
		hint: "blueprint.slot.accountabilityHint",
		placeholder: "form.unsatisfyingPlaceholder",
		input: "text",
		maxLength: 160,
	},
];

/** Every slot spec of a kind, in law order (also used by catalog tests). */
export function blueprintSlotSpecs(kind: HabitKind): readonly SlotSpec[] {
	return kind === "break" ? BREAK_SLOTS : BUILD_SLOTS;
}

const textOf = (value: unknown): string | null =>
	typeof value === "string" && value.trim() ? value : null;

function slotValue(habit: Habit, field: BlueprintField): string | null {
	if (habit.kind === "break" && field === "cueLocation") {
		return textOf(habit.cueLocation) ?? textOf(habit.stackAfter);
	}
	return textOf(habit[field]);
}

/** The board's slots in law order: 8 for build habits, 5 for break habits. */
export function blueprintSlots(habit: Habit): BlueprintSlot[] {
	return blueprintSlotSpecs(habit.kind).map((spec) => ({
		...spec,
		value: slotValue(habit, spec.field),
	}));
}

/** The slot's title: the formatted user value, or the concept when empty. */
export function slotTitle(slot: BlueprintSlot, t: Translator): string {
	const value = slot.value?.trim();
	if (!value) return t.t(slot.concept);
	if (slot.concept === "blueprint.concept.cueTime") {
		return t.t("blueprint.slot.cueTimeValue", { time: value });
	}
	if (slot.concept === "blueprint.concept.stackAfter") {
		return t.t("blueprint.slot.stackAfterValue", { stack: inSentence(value) });
	}
	if (slot.concept === "blueprint.concept.why") {
		return t.t("blueprint.slot.whyValue", { why: inSentence(withoutGetTo(value)) });
	}
	return value;
}

/** Column header: "law · stage" (inverse law names for break habits). */
export function lawHeading(
	law: BlueprintLaw,
	kind: HabitKind,
	t: Translator,
): { name: string; stage: string } {
	return {
		name: t.t(`law.${law}.${kind === "break" ? "inverse" : "name"}` as MessageKey),
		stage: t.t(`law.${law}.stage` as MessageKey),
	};
}

export function blueprintCompleteness(habit: Habit): { filled: number; total: number } {
	const slots = blueprintSlots(habit);
	return { filled: slots.filter((s) => s.value !== null).length, total: slots.length };
}

/** The law with the lowest share of filled slots; ties go to the lowest law (spec §3.2). */
export function weakestLaw(habit: Habit): BlueprintLaw {
	const filled = [0, 0, 0, 0, 0];
	const total = [0, 0, 0, 0, 0];
	for (const slot of blueprintSlots(habit)) {
		total[slot.law] = (total[slot.law] ?? 0) + 1;
		if (slot.value !== null) filled[slot.law] = (filled[slot.law] ?? 0) + 1;
	}
	let weakest: BlueprintLaw = 1;
	let lowest = Number.POSITIVE_INFINITY;
	for (const law of [1, 2, 3, 4] as const) {
		const count = total[law] ?? 0;
		if (!count) continue;
		const share = (filled[law] ?? 0) / count;
		if (share < lowest) {
			lowest = share;
			weakest = law;
		}
	}
	return weakest;
}

const FIELD_MAX: Record<BlueprintField, number> = {
	cueTime: 5,
	cueLocation: 120,
	stackAfter: 160,
	environment: 280,
	bundle: 160,
	why: 280,
	twoMinute: 160,
	reward: 160,
};

/**
 * The habit patch for an inline slot edit (Annex H §3.3): trims and caps the
 * value (empty → null); an invalid time is a no-op (`{}`); clearing `cueTime`
 * also turns the reminder off; clearing a break habit's trigger clears both
 * `cueLocation` and `stackAfter` (the trigger reads either).
 */
export function blueprintPatch(
	habit: Habit,
	field: BlueprintField,
	value: string | null,
): HabitPatch {
	const trimmed = value?.trim() ?? "";
	const next = trimmed ? trimmed.slice(0, FIELD_MAX[field]) : null;
	if (field === "cueTime") {
		if (next === null) return { cueTime: null, reminder: false };
		return timeSchema.safeParse(next).success ? { cueTime: next } : {};
	}
	if (habit.kind === "break" && field === "cueLocation" && next === null) {
		return { cueLocation: null, stackAfter: null };
	}
	return { [field]: next } as HabitPatch;
}
