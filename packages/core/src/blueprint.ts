import { type Weekday, orderedWeekdays } from "./dates";
import { type Translator, inSentence } from "./i18n";
import type { Habit, Identity } from "./model";

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
	if (habit.why) add(2, t.t("blueprint.why", { why: inSentence(habit.why) }));
	if (habit.twoMinute) add(3, t.t("blueprint.twoMinute", { twoMinute: habit.twoMinute }));
	if (habit.reward) add(4, t.t("blueprint.reward", { reward: habit.reward }));
	return lines;
}

export function identityLine(identity: Identity | undefined, t: Translator): string | null {
	if (!identity) return null;
	return t.t("blueprint.identity", { identity: inSentence(identity.statement) });
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

/** "3/8 glasses" style progress label. */
export function progressLabel(habit: Habit, count: number, t: Translator): string {
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
