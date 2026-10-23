import { useT } from "@/lib/messages";
import {
	type Habit,
	type TrackerConfig,
	type TrackerType,
	isTrackerActive,
	knownTracker,
	trackerCountKey,
	trackerDef,
	trackerMeta,
	trackerName,
	trackerUnitWord,
	trackersForKind,
} from "@atomic/core";
import { useActions, useHabit, useText } from "@atomic/core/react";
import { Info } from "lucide-react";
import { type FormEvent, type SyntheticEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { NumberField } from "../ui/number-field";
import { trackerCaps } from "./caps";
import { TrackerOptionCards, goalFor, newTrackerConfig } from "./tracker-picker";
import { TrackerSettingsFields } from "./tracker-settings";
import { useTrackerUI } from "./tracker-ui";

const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * "Tracker settings" from the habit page (Annex K §4.1): the tracker's
 * settings, or picking one to attach ("Try it" on the suggestion card,
 * "Log it in the app…"). Saving applies the attach rules in core (§1.5):
 * tracking starts today and the history stays as it is. Owner: T4.
 */
export function TrackerSettingsDialog() {
	const state = useTrackerUI((s) => s.settings);
	const close = useTrackerUI((s) => s.closeSettings);
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
			<DialogContent size="lg" onClick={stop} onPointerDown={stop} onContextMenu={stop}>
				{state ? (
					<SettingsGate key={`${state.habitId}:${state.type ?? ""}`} {...state} onDone={close} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function SettingsGate({
	habitId,
	type,
	onDone,
}: {
	habitId: string;
	type?: TrackerType;
	onDone(): void;
}) {
	const habit = useHabit(habitId);
	if (!habit) return null;
	return <SettingsForm habit={habit} type={type} onDone={onDone} />;
}

function SettingsForm({
	habit,
	type,
	onDone,
}: {
	habit: Habit;
	type?: TrackerType;
	onDone(): void;
}) {
	const { t } = useT();
	const text = useText();
	const actions = useActions();
	const goalId = useId();
	const stored = knownTracker(habit);
	const active = isTrackerActive(habit);
	const options = trackersForKind(habit.kind, trackerCaps());
	// A stored tracker of an unreleased milestone still gets its settings.
	const storedDef = stored ? trackerDef(stored.type) : undefined;
	const choices =
		storedDef && !options.some((def) => def.type === storedDef.type)
			? [...options, storedDef]
			: options;
	const current = { target: habit.target, unit: habit.unit };
	const initialConfig = (): TrackerConfig | null => {
		const wanted = type ?? stored?.type ?? options[0]?.type;
		if (!wanted) return null;
		if (stored?.type === wanted) return { ...stored, enabled: true } as TrackerConfig;
		return newTrackerConfig(wanted, t.locale, { cueTime: habit.cueTime, target: habit.target });
	};
	const [config, setConfig] = useState<TrackerConfig | null>(initialConfig);
	const [goal, setGoal] = useState<number | null>(() => {
		const first = initialConfig();
		return first ? goalFor(first, current, t).target : habit.target;
	});
	if (!config) return null;

	const meta = trackerMeta(config);
	const summed = meta.measure(config) === "sum";
	const unit = trackerUnitWord(meta.unit(config), config, t);
	const attaching = !active || stored?.type !== config.type;
	// Pages → minutes and the like restart the count today too (Annex K §1.5).
	const recounting = !attaching && trackerCountKey(stored) !== trackerCountKey(config);
	const name = trackerName(config.type, t);

	const pick = (next: TrackerType | "simple") => {
		if (next === "simple" || next === config.type) return;
		const fresh =
			stored?.type === next
				? ({ ...stored, enabled: true } as TrackerConfig)
				: newTrackerConfig(next, t.locale, { cueTime: habit.cueTime, target: habit.target });
		setConfig(fresh);
		setGoal(goalFor(fresh, current, t).target);
	};

	const change = (next: TrackerConfig) => {
		const before = trackerMeta(config);
		const after = trackerMeta(next);
		if (
			before.measure(config) !== after.measure(next) ||
			before.unit(config) !== after.unit(next)
		) {
			setGoal(goalFor(next, current, t).target);
		}
		setConfig(next);
	};

	const save = (event: FormEvent) => {
		event.preventDefault();
		event.stopPropagation();
		// What Undo puts back: the setup before this save (attaching may also change the goal
		// and the unit), read now, not from a render that is gone by the time Undo is pressed.
		const before = { tracker: habit.tracker ?? null, target: habit.target, unit: habit.unit };
		if (summed && goal && goal !== habit.target) actions.updateHabit(habit.id, { target: goal });
		actions.setTracker(habit.id, config);
		if (attaching) {
			toast(t("tracker.attached", { tracker: name }), {
				description: t("tracker.startsToday"),
				action: {
					label: t("common.undo"),
					onClick: () => actions.restoreTrackerSetup(habit.id, before),
				},
			});
		} else toast(t("common.saved"), { description: name });
		onDone();
	};

	return (
		<form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
			<DialogHeader
				title={t("tracker.settings")}
				description={`${habit.emoji} ${text.habit(habit, "name")}`}
			/>
			<DialogBody className="flex flex-col gap-6">
				{active && !type ? null : (
					<TrackerOptionCards
						kind={habit.kind}
						options={choices}
						value={config.type}
						onChange={pick}
						label={t("tracker.field")}
						simple={false}
					/>
				)}
				{attaching || recounting ? (
					<p className="flex items-start gap-2 rounded-lg bg-sunken/70 px-3 py-2.5 text-ink-muted text-small">
						<Info className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
						{recounting
							? t("tracker.settings.recountHint")
							: active
								? t("tracker.settings.switchHint")
								: t("tracker.startsToday")}
					</p>
				) : null}
				<TrackerSettingsFields config={config} onChange={change} />
				{summed ? (
					<div className="flex flex-col gap-1.5">
						<label htmlFor={goalId} className="font-medium text-ink text-small">
							{t("tracker.settings.dailyGoal")}
						</label>
						<NumberField
							id={goalId}
							value={goal}
							min={1}
							max={10_000}
							stepper
							onChange={setGoal}
							suffix={unit ?? undefined}
							className="w-44"
						/>
					</div>
				) : null}
			</DialogBody>
			<DialogFooter>
				<Button variant="secondary" onClick={onDone}>
					{t("common.cancel")}
				</Button>
				<Button type="submit">{t("tracker.save")}</Button>
			</DialogFooter>
		</form>
	);
}
