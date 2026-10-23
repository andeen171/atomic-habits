import { useT } from "@/lib/messages";
import { type RepeatRule, type SetupField, setupFieldsFor } from "@atomic/core";
import { useAtomic, useHabitSetupTasks, useToday } from "@atomic/core/react";
import { useEffect, useId, useRef } from "react";
import { RepeatField, sameRule } from "../tasks/repeat-field";
import { Switch } from "../ui/switch";
import type { HabitDraft } from "./draft";
import type { DraftUpdate } from "./editor-fields";
import {
	LinkedTaskChip,
	defaultSetupRepeat,
	linkedSetupTask,
	newSetupDraft,
	useSameDaysPreset,
	useSetupRetitleOnSave,
} from "./setup-shared";

export interface SetupTaskToggleProps {
	/** The convertible field the toggle sits under (build `environment`; break `environment`, `twoMinute`, `reward`). */
	field: SetupField;
	draft: HabitDraft;
	update: DraftUpdate;
	/** The habit being edited (edit mode): a linked task shows as a chip that opens it. */
	habitId?: string;
}

/**
 * "Also create a task" under a convertible field (Annex T §4.4): a `Switch`
 * (`setup.toggle`) shown once the field has text; when on, a compact
 * `RepeatField` defaulting to `suggestRepeatFromText` ("every morning" →
 * Every day), plus "Same days as the habit". It writes `draft.setupTasks`
 * (title null: the task follows the field's text at save time). In edit mode
 * a field that already has a linked task (going, or else done) shows the
 * `setup.linked` chip ("Task: Every day"), which opens that task, instead of
 * the switch.
 */
export function SetupTaskToggle({ field, draft, update, habitId }: SetupTaskToggleProps) {
	const { t } = useT();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const setup = useHabitSetupTasks(habitId);
	const switchId = useId();
	useSetupRetitleOnSave(habitId);

	const spec = setupFieldsFor(draft.kind).find((s) => s.field === field);
	const text = draft[field].trim();
	const linked = habitId ? linkedSetupTask(setup, field) : null;
	const own = draft.setupTasks.find((d) => d.field === field);
	const sameDays = useSameDaysPreset(draft, own?.date ?? today);

	// While the repeat is still the default for the text, it follows the text
	// ("…every morning" turns it into Every day). A rule the user picked stays.
	const previous = useRef(text);
	useEffect(() => {
		const before = previous.current;
		previous.current = text;
		if (!own || before === text) return;
		if (!sameRule(own.repeat, defaultSetupRepeat(before, own.date, weekStartsOn))) return;
		const next = defaultSetupRepeat(text, own.date, weekStartsOn);
		if (sameRule(next, own.repeat)) return;
		update({
			setupTasks: draft.setupTasks.map((d) => (d.key === own.key ? { ...d, repeat: next } : d)),
		});
	}, [text, own, draft.setupTasks, update, weekStartsOn]);

	if (!spec) return null;

	if (linked) {
		return (
			<div>
				<LinkedTaskChip task={linked.task} done={linked.done} />
			</div>
		);
	}

	if (!text) return null;

	const toggle = (on: boolean) => {
		const others = draft.setupTasks.filter((d) => d.field !== field);
		update({
			setupTasks: on
				? [
						...others,
						newSetupDraft({
							field,
							law: spec.law,
							title: null,
							repeat: defaultSetupRepeat(text, today, weekStartsOn),
							date: today,
						}),
					]
				: others,
		});
	};

	const setRepeat = (repeat: RepeatRule | null) => {
		if (!own) return;
		update({
			setupTasks: draft.setupTasks.map((d) => (d.key === own.key ? { ...d, repeat } : d)),
		});
	};

	return (
		<div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
			<label
				htmlFor={switchId}
				className="inline-flex cursor-pointer select-none items-center gap-2.5 text-ink text-small"
			>
				<Switch id={switchId} checked={!!own} onCheckedChange={toggle} />
				<span>{t("setup.toggle")}</span>
			</label>
			{own ? (
				<RepeatField
					compact
					value={own.repeat}
					onChange={setRepeat}
					start={own.date}
					weekStartsOn={weekStartsOn}
					noneLabel={t("repeat.once")}
					extraPresets={sameDays}
					className="min-w-0"
				/>
			) : null}
		</div>
	);
}
