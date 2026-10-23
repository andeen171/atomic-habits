import { Info } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
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
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { trackerCaps } from "./caps";
import { TrackerOptionCards, goalFor, newTrackerConfig } from "./tracker-picker";
import { TrackerSettingsFields } from "./tracker-settings";
import { type TrackerSettingsTarget, trackerUI, useTrackerUI } from "./tracker-ui";

/**
 * "Tracker settings" from the habit page (Annex K §5.1
 * `tracker-settings-sheet.tsx`): the tracker's settings, or picking one to
 * attach ("Try it" on the suggestion card, "Log it in the app…"). Saving
 * applies core's attach rules (§1.5): tracking starts today and the history
 * stays as it is, with Undo. Owner: T4.
 */
export function TrackerSettingsSheet() {
	const target = useTrackerUI((s) => s.settings);
	const [last, setLast] = useState<TrackerSettingsTarget | null>(target);
	useEffect(() => {
		if (target) setLast(target);
	}, [target]);
	// Each opening starts a fresh form (a new target object), kept while the sheet slides away.
	const session = useRef({ target: null as TrackerSettingsTarget | null, count: 0 });
	if (target && target !== session.current.target) {
		session.current = { target, count: session.current.count + 1 };
	}
	const shown = target ?? last;
	const habit = useHabit(shown?.habitId);
	if (!shown || !habit) return <Sheet open={false} onClose={trackerUI.closeSettings} />;
	return (
		<SettingsForm
			key={session.current.count}
			habit={habit}
			type={shown.type}
			open={target !== null}
		/>
	);
}

function SettingsForm({
	habit,
	type,
	open,
}: {
	habit: Habit;
	type?: TrackerType;
	open: boolean;
}) {
	const t = useT();
	const text = useText();
	const actions = useActions();
	const { colors } = useTheme();
	const styles = useStyles();
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
	if (!config) return <Sheet open={false} onClose={trackerUI.closeSettings} />;

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

	const save = () => {
		// What Undo puts back: the setup before this save (attaching may also change the goal
		// and the unit), read now, not from a render that is gone by the time Undo is pressed.
		const before = { tracker: habit.tracker ?? null, target: habit.target, unit: habit.unit };
		if (summed && goal && goal !== habit.target) actions.updateHabit(habit.id, { target: goal });
		actions.setTracker(habit.id, config);
		haptics.success();
		if (attaching) {
			showToast(`${t.t("tracker.attached", { tracker: name })} · ${t.t("tracker.startsToday")}`, {
				tone: "success",
				duration: 6000,
				action: {
					label: t.t("common.undo"),
					onPress: () => actions.restoreTrackerSetup(habit.id, before),
				},
			});
		} else showToast(`${t.t("common.saved")} · ${name}`, { tone: "success" });
		trackerUI.closeSettings();
	};

	return (
		<Sheet
			open={open}
			onClose={trackerUI.closeSettings}
			title={t.t("tracker.settings")}
			subtitle={`${habit.emoji} ${text.habit(habit, "name")}`}
			scroll
			closeButton
			testID="tracker-settings-sheet"
			footer={
				<Button
					label={t.t("tracker.save")}
					size="lg"
					fullWidth
					onPress={save}
					testID="tracker-settings-save"
				/>
			}
		>
			<View style={styles.body}>
				{active && !type ? null : (
					<TrackerOptionCards
						kind={habit.kind}
						options={choices}
						value={config.type}
						onChange={pick}
						label={t.t("tracker.field")}
						simple={false}
					/>
				)}
				{attaching || recounting ? (
					<View style={styles.hint}>
						<Info size={15} color={colors.textMuted} style={{ marginTop: 2 }} />
						<Text variant="small" tone="muted" style={styles.grow}>
							{recounting
								? t.t("tracker.settings.recountHint")
								: active
									? t.t("tracker.settings.switchHint")
									: t.t("tracker.startsToday")}
						</Text>
					</View>
				) : null}
				<TrackerSettingsFields config={config} onChange={change} />
				{summed ? (
					<NumberField
						label={t.t("tracker.settings.dailyGoal")}
						value={goal}
						min={1}
						max={10_000}
						step={1}
						unit={unit ?? undefined}
						onChange={setGoal}
					/>
				) : null}
			</View>
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 22, paddingBottom: 4 },
	grow: { flex: 1 },
	hint: {
		flexDirection: "row",
		gap: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
}));
