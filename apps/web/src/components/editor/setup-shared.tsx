import { type CallableTranslator, useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import {
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
	type Weekday,
	anchorOf,
	createId,
	presetKeyOf,
	repeatFromSchedule,
	repeatLabel,
	repeatRuleSchema,
	setupFieldsFor,
	setupTitleUpdate,
	suggestRepeatFromText,
	weekdayOf,
} from "@atomic/core";
import { useActions, useAtomic, useAtomicStore, useText } from "@atomic/core/react";
import { ChevronRight, CircleCheck, ListChecks, Repeat } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import type { ExtraRepeatPreset } from "../tasks/repeat-field";
import { type HabitDraft, draftToInput } from "./draft";

/**
 * Shared pieces of the setup-task UI (Annex T §1.5 and §4.4, spec §5.6):
 * draft helpers for the editor's toggles, adders and review list, and the
 * "Update the linked task too?" offer when a linked field is saved with new
 * text (spec §2.5). Owner: T2.
 */

const TITLE_MAX = 280;

/** What a setup task is called from its text: trimmed, capitalized, at most 280 characters (core `setup.ts`). */
export function setupTitle(text: string | null | undefined): string {
	const trimmed = (text ?? "").trim().slice(0, TITLE_MAX).trim();
	return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
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
export function lawName(law: TaskLaw, kind: HabitKind, t: CallableTranslator): string {
	return t(`law.${law}.${kind === "break" ? "inverse" : "name"}`);
}

/** The draft's text for each convertible field. */
export function draftFieldText(draft: HabitDraft): Record<SetupField, string> {
	return { environment: draft.environment, twoMinute: draft.twoMinute, reward: draft.reward };
}

/**
 * "Same days as the habit" (Annex T §1.5) for a draft's schedule: only when
 * the schedule maps to a rule (not "N times a week") and that rule isn't
 * already one of the built-in presets ("Every day").
 */
export function useSameDaysPreset(
	draft: HabitDraft,
	start: DayKey,
): ExtraRepeatPreset[] | undefined {
	const { t } = useT();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	// A string, so the memo only changes with the schedule itself.
	const key = JSON.stringify(draftToInput(draft, null).schedule ?? null);
	return useMemo(() => {
		const schedule = JSON.parse(key) as Schedule | null;
		if (!schedule) return undefined;
		const rule = repeatFromSchedule(schedule, start, weekStartsOn === 0 ? 0 : 1);
		if (!rule || presetKeyOf(rule, start) !== "custom") return undefined;
		return [{ key: "same-as-habit", label: t("repeat.sameAsHabit"), rule }];
	}, [key, start, weekStartsOn, t]);
}

// ── "Update the linked task too?" (spec §2.5) ─────────────────────────────

/**
 * Offers to retitle the task linked to `field` after the habit's text for it
 * changed: a toast whose action renames the task. Never automatic. The toast
 * id is per task, so a second offer for the same task replaces the first.
 */
export function offerSetupRetitle(
	habit: Pick<Habit, "id" | "kind"> & Partial<Record<SetupField, string | null>>,
	field: SetupField,
	tasks: Readonly<Record<string, Task>>,
	t: CallableTranslator,
	actions: Pick<AtomicActions, "updateTask">,
): void {
	const update = setupTitleUpdate(habit, field, habit[field] ?? null, tasks);
	if (!update) return;
	toast(t("setup.updateTitle"), {
		id: `setup-retitle:${update.taskId}`,
		description: update.title,
		duration: 10000,
		action: {
			label: t("setup.updateTitleAction"),
			onClick: () => actions.updateTask(update.taskId, { title: update.title }),
		},
	});
}

type FieldValues = Record<SetupField, string>;

const valuesOf = (habit: Habit): FieldValues => ({
	environment: (habit.environment ?? "").trim(),
	twoMinute: (habit.twoMinute ?? "").trim(),
	reward: (habit.reward ?? "").trim(),
});

/** Habits open in the editor, with their convertible fields as last committed. */
const watched = new Map<string, FieldValues>();
const latest: { t: CallableTranslator | null; actions: AtomicActions | null } = {
	t: null,
	actions: null,
};
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
 * habit is open in the editor (edit mode), saving a convertible field with
 * new text offers to retitle its linked task. Mounted by the setup-task
 * toggles and the review list. The watch outlives step changes in the guided
 * editor and ends when the habit's page shows again
 * (`releaseSetupRetitle`), where the blueprint board makes its own offer.
 */
export function useSetupRetitleOnSave(habitId: string | undefined): void {
	const store = useAtomicStore();
	const { t } = useT();
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

/** The habit page is showing again: its board's slot editor offers retitles itself. */
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
export function linkedSetupLabel(task: Task, t: CallableTranslator, weekStartsOn: Weekday): string {
	const repeat = task.repeat
		? repeatLabel(task.repeat, t, { start: anchorOf(task), weekStartsOn, short: true })
		: t("repeat.once");
	return t("setup.linked", { repeat });
}

/** The linked task as a chip that opens it in the task dialog. */
export function LinkedTaskChip({ task, done }: { task: Task; done: boolean }) {
	const { t } = useT();
	const text = useText();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	const label = linkedSetupLabel(task, t, weekStartsOn);
	const title = text.task(task, "title");
	return (
		<button
			type="button"
			onClick={() => openTaskDialog({ mode: "edit", id: task.id })}
			aria-label={`${label}: ${title}${done ? ` (${t("tasks.series.doneState")})` : ""}`}
			className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface py-1 pr-2 pl-2.5 text-left font-medium text-ink text-small transition-colors duration-(--atomic-duration-fast) hover:border-line-strong hover:bg-hover"
		>
			{done ? (
				<CircleCheck aria-hidden="true" className="size-3.5 shrink-0 text-success" />
			) : (
				<ListChecks aria-hidden="true" className="size-3.5 shrink-0 text-accent-text" />
			)}
			<span className="min-w-0 break-words">{label}</span>
			<ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-subtle" />
		</button>
	);
}

/**
 * A setup task's second line: "Make it obvious · ↻ Every day" (or
 * "… · Once · Today"), as one run of text so it wraps like a sentence.
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
	const { t } = useT();
	return (
		<p className="mt-0.5 text-ink-muted text-small">
			{law ? (
				<>
					{lawName(law, kind, t)}
					<span aria-hidden="true" className="text-ink-subtle">
						{" · "}
					</span>
					<span className="sr-only">, </span>
				</>
			) : null}
			{repeating ? (
				<Repeat aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
			) : null}
			{when}
		</p>
	);
}
