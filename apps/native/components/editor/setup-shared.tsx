import { ChevronRight, CircleCheck, ListChecks, Repeat } from "@/components/icons";
import type { ExtraRepeatPreset } from "@/components/tasks/repeat-sheet";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { dismissToast, showToast } from "@/lib/ui-store";
import {
	type AnyRepeat,
	type AtomicActions,
	type AtomicStore,
	type DayKey,
	type Habit,
	type HabitKind,
	type HabitSetupTasks,
	type RepeatRule,
	type Schedule,
	type SetupField,
	type SetupTaskDraft,
	type Task,
	type TaskLaw,
	type Translator,
	type Weekday,
	anchorOf,
	createId,
	presetKeyOf,
	repeatFromSchedule,
	repeatLabel,
	repeatRuleSchema,
	resolveSetupDrafts,
	setupFieldsFor,
	setupTitleUpdate,
	suggestRepeatFromText,
	weekdayOf,
} from "@atomic/core";
import { useActions, useAtomic, useAtomicStore, useI18n, useText } from "@atomic/core/react";
import { router } from "expo-router";
import { useEffect, useMemo } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import type { SetupDraftFields } from "./setup-draft";

/**
 * Shared pieces of the native setup-task UI (Annex T §1.5 and §5.4, spec §6):
 * draft helpers for the editor's toggles, adders and review list, the linked
 * task chip, and the "Update the linked task too?" offer when a linked field
 * is saved with new text (spec §2.5). Mirrors the web `setup-shared.tsx`.
 * Owner: T2.
 */

const TITLE_MAX = 280;

/** What a setup task is called from its text: trimmed, capitalized, at most 280 characters (core `setup.ts`). */
export function setupTitle(text: string | null | undefined): string {
	const trimmed = (text ?? "").trim().slice(0, TITLE_MAX).trim();
	return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
}

/** Two rules are the same (null = once). */
export function sameRule(
	a: AnyRepeat | null | undefined,
	b: AnyRepeat | null | undefined,
): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The default repeat for a setup task from its text: "every morning" →
 * every day, "weekly" → weekly on the start's weekday, otherwise once.
 */
export function defaultSetupRepeat(
	text: string,
	start: DayKey,
	weekStartsOn: number,
): RepeatRule | null {
	const suggestion = suggestRepeatFromText(text);
	if (suggestion === "daily") return repeatRuleSchema.parse({ type: "days", every: 1 });
	if (suggestion === "weekly") {
		return repeatRuleSchema.parse({
			type: "weeks",
			every: 1,
			days: [weekdayOf(start)],
			weekStart: weekStartsOn === 0 ? 0 : 1,
		});
	}
	return null;
}

export function newSetupDraft(
	fields: Pick<SetupTaskDraft, "field" | "law" | "title" | "repeat" | "date">,
): SetupTaskDraft {
	return { key: createId(), ...fields };
}

/** "Make it obvious" for build habits, "Make it invisible" for break habits. */
export function lawName(law: TaskLaw, kind: HabitKind, t: Translator): string {
	return t.t(`law.${law}.${kind === "break" ? "inverse" : "name"}`);
}

/** The draft's text for each convertible field. */
export function draftFieldText(draft: SetupDraftFields): Record<SetupField, string> {
	return { environment: draft.environment, twoMinute: draft.twoMinute, reward: draft.reward };
}

/**
 * Editor save step 3 (spec §5.4): creates the draft's setup tasks for the
 * saved habit (`resolveSetupDrafts` → `createSetupTasks`) and returns how
 * many were added, for the `setup.created` toast. For T1's `save()`.
 */
export function createDraftSetupTasks(
	actions: Pick<AtomicActions, "createSetupTasks">,
	habitId: string,
	draft: SetupDraftFields,
): number {
	const inputs = resolveSetupDrafts(draft.setupTasks, draftFieldText(draft), draft.kind);
	return inputs.length ? actions.createSetupTasks(habitId, inputs).length : 0;
}

/**
 * "Same days as the habit" (Annex T §1.5) for a draft's schedule: only when
 * the schedule maps to a rule (not "N times a week") and that rule isn't
 * already one of the built-in presets ("Every day"). Break habits are daily.
 */
export function useSameDaysPreset(
	draft: SetupDraftFields,
	start: DayKey,
): ExtraRepeatPreset[] | undefined {
	const t = useI18n();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	// A string, so the memo only changes with the schedule itself.
	const key = JSON.stringify(draft.kind === "break" ? { type: "daily" } : draft.schedule);
	return useMemo(() => {
		const schedule = JSON.parse(key) as Schedule;
		const rule = repeatFromSchedule(schedule, start, weekStartsOn === 0 ? 0 : 1);
		if (!rule || presetKeyOf(rule, start) !== "custom") return undefined;
		return [{ key: "same-as-habit", label: t.t("repeat.sameAsHabit"), rule }];
	}, [key, start, weekStartsOn, t]);
}

// ── "Update the linked task too?" (spec §2.5) ─────────────────────────────

/** The offer showing for each task, so a second offer replaces the first. */
const offers = new Map<string, number>();

/**
 * Offers to retitle the task linked to `field` after the habit's text for it
 * changed: a toast whose action renames the task. Never automatic.
 */
export function offerSetupRetitle(
	habit: Pick<Habit, "id" | "kind"> & Partial<Record<SetupField, string | null>>,
	field: SetupField,
	tasks: Readonly<Record<string, Task>>,
	t: Translator,
	actions: Pick<AtomicActions, "updateTask">,
): void {
	const update = setupTitleUpdate(habit, field, habit[field] ?? null, tasks);
	if (!update) return;
	const previous = offers.get(update.taskId);
	if (previous !== undefined) dismissToast(previous);
	const id = showToast(`${t.t("setup.updateTitle")}\n${update.title}`, {
		duration: 10000,
		action: {
			label: t.t("setup.updateTitleAction"),
			onPress: () => {
				offers.delete(update.taskId);
				actions.updateTask(update.taskId, { title: update.title });
				haptics.light();
			},
		},
	});
	offers.set(update.taskId, id);
}

type FieldValues = Record<SetupField, string>;

const valuesOf = (habit: Habit): FieldValues => ({
	environment: (habit.environment ?? "").trim(),
	twoMinute: (habit.twoMinute ?? "").trim(),
	reward: (habit.reward ?? "").trim(),
});

/** Habits open in the editor, with their convertible fields as last committed. */
const watched = new Map<string, FieldValues>();
const latest: { t: Translator | null; actions: AtomicActions | null } = { t: null, actions: null };
let watchedStore: AtomicStore | null = null;
let stopWatching: (() => void) | null = null;

function watch(store: AtomicStore): void {
	if (watchedStore === store) return;
	stopWatching?.();
	watchedStore = store;
	stopWatching = store.subscribeCommits(({ origin, changes }) => {
		for (const habit of changes.habits ?? []) {
			const before = watched.get(habit.id);
			if (!before) continue;
			const after = valuesOf(habit);
			watched.set(habit.id, after);
			// Only the user's own saves: a synced edit from another device isn't an offer here.
			if (origin !== "local" || habit.deletedAt || !latest.t || !latest.actions) continue;
			for (const { field } of setupFieldsFor(habit.kind)) {
				if (before[field] === after[field]) continue;
				offerSetupRetitle(habit, field, store.getState().data.tasks, latest.t, latest.actions);
			}
		}
	});
}

/**
 * The editor's half of the retitle offer (spec §5.4 save step 4): while a
 * habit is open in the editor, saving a convertible field with new text
 * offers to retitle its linked task. Mounted by the setup-task toggles and
 * the review list. The watch outlives step changes in the guided editor and
 * ends when the habit's page is focused again (`releaseSetupRetitle`), where
 * the blueprint slot sheet makes its own offer.
 */
export function useSetupRetitleOnSave(habitId: string | null | undefined): void {
	const store = useAtomicStore();
	const t = useI18n();
	const actions = useActions();
	useEffect(() => {
		latest.t = t;
		latest.actions = actions;
	}, [t, actions]);
	useEffect(() => {
		if (!habitId) return;
		const habit = store.getState().data.habits[habitId];
		if (!habit) return;
		// Nothing is committed while the editor is open, so this is the "before" of the save.
		watched.set(habitId, valuesOf(habit));
		watch(store);
	}, [habitId, store]);
}

/** The habit page is showing again: its blueprint slot sheet offers retitles itself. */
export function releaseSetupRetitle(habitId: string): void {
	watched.delete(habitId);
}

// ── The task already linked to a field ────────────────────────────────────

/**
 * The task a convertible field already has: the one still going (open,
 * repeating or paused), otherwise the newest done or stopped one. A field
 * with a task shows it as a chip instead of offering another.
 */
export function linkedSetupTask(
	setup: HabitSetupTasks,
	field: SetupField,
): { task: Task; done: boolean } | null {
	const going = setup.covering.get(field);
	if (going) return { task: going, done: false };
	const last = setup.byField.get(field)?.[0];
	return last ? { task: last, done: true } : null;
}

/** "Task: Every day" (or "Task: Once"). */
export function linkedSetupLabel(task: Task, t: Translator, weekStartsOn: Weekday): string {
	const repeat = task.repeat
		? repeatLabel(task.repeat, t, { start: anchorOf(task), weekStartsOn, short: true })
		: t.t("repeat.once");
	return t.t("setup.linked", { repeat });
}

/** Opens a task in the task sheet (`/task/[id]`). */
export function openTask(task: Task): void {
	haptics.selection();
	router.push({ pathname: "/task/[id]", params: { id: task.id } });
}

/** The linked task as a chip ("Task: Every day ›") that opens it in the task sheet. */
export function LinkedTaskChip({
	task,
	done,
	style,
}: {
	task: Task;
	done: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const label = linkedSetupLabel(task, t, weekStartsOn);
	const title = text.task(task, "title");
	const Icon = done ? CircleCheck : ListChecks;
	return (
		<PressableScale
			onPress={() => openTask(task)}
			scaleTo={0.96}
			hitSlop={6}
			accessibilityRole="button"
			accessibilityLabel={`${label}: ${title}${done ? ` (${t.t("tasks.series.doneState")})` : ""}`}
			accessibilityHint={t.t("tasks.edit")}
			style={[styles.chip, style]}
			testID={`setup-linked-${task.id}`}
		>
			<Icon size={15} color={done ? colors.success : colors.accentText} strokeWidth={2.2} />
			<Text variant="small" weight="medium" style={styles.chipText}>
				{label}
			</Text>
			<ChevronRight size={15} color={colors.textSubtle} />
		</PressableScale>
	);
}

/**
 * A setup task's second line: "Make it obvious · ↻ Every day" (or
 * "… · Once · Today"); the parts wrap as whole pieces on narrow screens.
 */
export function SetupMeta({
	law,
	kind,
	repeating,
	when,
}: {
	law: TaskLaw | null;
	kind: HabitKind;
	repeating: boolean;
	/** The repeat label, or "Once · Today". */
	when: string;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const lawText = law ? lawName(law, kind, t) : null;
	return (
		<View
			style={styles.meta}
			accessible
			accessibilityLabel={lawText ? `${lawText}, ${when}` : when}
		>
			{lawText ? (
				<Text variant="small" tone="muted">
					{lawText}
					<Text variant="small" tone="subtle">
						{" ·"}
					</Text>
				</Text>
			) : null}
			<View style={styles.when}>
				{repeating ? <Repeat size={12} color={colors.textMuted} strokeWidth={2.2} /> : null}
				<Text variant="small" tone="muted" style={styles.whenText}>
					{when}
				</Text>
			</View>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	chip: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		maxWidth: "100%",
		gap: 6,
		minHeight: 34,
		paddingLeft: 11,
		paddingRight: 9,
		paddingVertical: 6,
		borderRadius: 17,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	chipText: { flexShrink: 1 },
	meta: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		columnGap: 5,
		rowGap: 1,
		marginTop: 2,
	},
	when: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
	whenText: { flexShrink: 1 },
}));
