import { Check, Info } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type Habit,
	type HabitKind,
	type Locale,
	type TrackerConfig,
	type TrackerConfigInput,
	type TrackerDef,
	type TrackerType,
	type Translator,
	defaultTrackerConfig,
	knownTracker,
	trackerHint,
	trackerMeta,
	trackerName,
	trackerUnitWord,
	trackersForKind,
} from "@atomic/core";
import { useHabit } from "@atomic/core/react";
import { useLocalSearchParams } from "expo-router";
import { useRef } from "react";
import { View } from "react-native";
import { deviceRegion, trackerCaps } from "./caps";
import { TrackerSettingsFields } from "./tracker-settings";

/**
 * The habit-editor draft fields the tracker components read (Annex K §5.3).
 * The editor's `Draft` satisfies it structurally.
 */
export interface TrackerDraftFields {
	kind: HabitKind;
	name: string;
	/** Null: simple check-off. */
	tracker: TrackerConfigInput | null;
	target: number;
	unit: string;
	/** The cue time, when the draft has one (a new wake tracker starts from it). */
	cueTime?: string | null;
}

/** Merges a patch into the editor draft (a preset may also set the goal and unit). */
export type TrackerDraftUpdate = (
	patch: Partial<Pick<TrackerDraftFields, "tracker" | "target" | "unit">>,
) => void;

export interface TrackerFieldProps {
	draft: TrackerDraftFields;
	update: TrackerDraftUpdate;
}

/** A draft's tracker parsed with defaults, when it is known and switched on. */
export function draftTracker(tracker: TrackerConfigInput | null): TrackerConfig | null {
	if (!tracker || tracker.enabled === false) return null;
	return knownTracker({ tracker } as Pick<Habit, "tracker">);
}

/** A new config of a type, prefilled from the habit (wake time from the cue, currency from the device). */
export function newTrackerConfig(
	type: TrackerType,
	locale: Locale,
	habit: { cueTime: string | null; target: number },
): TrackerConfig {
	return defaultTrackerConfig(type, { locale, region: deviceRegion(), habit });
}

/**
 * The goal that goes with a tracker (Annex K §1.5): days and threshold
 * measures are done once (target 1, no unit); sum measures suggest the
 * tracker's default target unless the habit already counts in that unit.
 */
export function goalFor(
	config: TrackerConfig,
	current: { target: number; unit: string | null },
	t: Translator,
): { target: number; unit: string | null } {
	const meta = trackerMeta(config);
	const measure = meta.measure(config);
	const unit = trackerUnitWord(meta.unit(config), config, t);
	if (measure === "days" || measure === "threshold") return { target: 1, unit: null };
	const sameUnit =
		!!unit && !!current.unit && current.unit.trim().toLowerCase() === unit.toLowerCase();
	return {
		target: sameUnit && current.target > 1 ? current.target : meta.defaultTarget(config),
		unit,
	};
}

/**
 * "How will you log it?" (Annex K §4.1 `TrackerField`, §5.1): radio cards
 * for "Simple check-off" and the trackers for the habit's kind (break habits
 * see only the slip journal), with the chosen tracker's settings inline.
 * Choosing one sets the goal it needs; choosing "Simple check-off" in the
 * same editing session gives back the goal from before. Hidden until a
 * tracker milestone is released. Owner: T4.
 */
export function TrackerField({ draft, update }: TrackerFieldProps) {
	const t = useT();
	const styles = useStyles();
	const { colors } = useTheme();
	const options = trackersForKind(draft.kind, trackerCaps());
	// Edit mode: the stored habit decides "back to simple" (detach) and the "starts today" hint.
	const params = useLocalSearchParams<{ id?: string }>();
	const stored = useHabit(typeof params.id === "string" ? params.id : undefined);
	const storedConfig = stored ? knownTracker(stored) : null;
	const storedActive = !!storedConfig && storedConfig.enabled !== false;
	const plainGoal = useRef<{ target: number; unit: string } | null>(null);
	const openedGoal = useRef({ target: draft.target, unit: draft.unit });
	if (!options.length) return null;

	const config = draftTracker(draft.tracker);
	const selected: TrackerType | "simple" = config?.type ?? "simple";
	const current = { target: draft.target, unit: draft.unit.trim() || null };

	const choose = (type: TrackerType | "simple") => {
		if (type === selected) return;
		if (type === "simple") {
			// A stored tracker is switched off (kept for later); a new one is simply dropped.
			const base = draft.tracker ?? storedConfig;
			update({
				tracker: stored && base ? ({ ...base, enabled: false } as TrackerConfigInput) : null,
				...(plainGoal.current ?? openedGoal.current),
			});
			plainGoal.current = null;
			return;
		}
		if (selected === "simple") plainGoal.current = { target: draft.target, unit: draft.unit };
		const next =
			draft.tracker?.type === type
				? (draftTracker({ ...draft.tracker, enabled: true } as TrackerConfigInput) as TrackerConfig)
				: storedConfig?.type === type
					? ({ ...storedConfig, enabled: true } as TrackerConfig)
					: newTrackerConfig(type, t.locale, {
							cueTime: draft.cueTime ?? null,
							target: draft.target,
						});
		const goal = goalFor(next, current, t);
		update({ tracker: next, target: goal.target, unit: goal.unit ?? "" });
	};

	const change = (next: TrackerConfig) => {
		const before = config ? trackerMeta(config).measure(config) : null;
		const after = trackerMeta(next).measure(next);
		const unitChanged = config && trackerMeta(config).unit(config) !== trackerMeta(next).unit(next);
		if (before !== after || unitChanged) {
			const goal = goalFor(next, current, t);
			update({ tracker: next, target: goal.target, unit: goal.unit ?? "" });
		} else update({ tracker: next });
	};

	const hint =
		stored && config
			? storedActive && storedConfig?.type !== config.type
				? t.t("tracker.settings.switchHint")
				: !storedActive
					? t.t("tracker.startsToday")
					: null
			: null;

	return (
		<View style={styles.section} testID="tracker-field">
			<View style={styles.heading}>
				<Text variant="small" weight="medium" tone="muted" accessibilityRole="header">
					{t.t("tracker.field")}
				</Text>
				<Text variant="small" tone="subtle">
					{t.t("tracker.fieldHint")}
				</Text>
			</View>
			<TrackerOptionCards
				kind={draft.kind}
				options={options}
				value={selected}
				onChange={choose}
				label={t.t("tracker.field")}
			/>
			{config ? (
				<View style={styles.settings}>
					{hint ? (
						<View style={styles.hint}>
							<Info size={15} color={colors.textMuted} style={{ marginTop: 2 }} />
							<Text variant="small" tone="muted" style={styles.grow}>
								{hint}
							</Text>
						</View>
					) : null}
					<TrackerSettingsFields config={config} onChange={change} />
				</View>
			) : null}
		</View>
	);
}

/**
 * Radio cards: "Simple check-off" (optional) and the trackers, each with its
 * icon, name and one-line hint. Selected cards carry the accent outline and
 * a check, and say "selected" to screen readers.
 */
export function TrackerOptionCards({
	kind,
	options,
	value,
	onChange,
	label,
	simple = true,
}: {
	kind: HabitKind;
	options: readonly TrackerDef[];
	value: TrackerType | "simple";
	onChange(value: TrackerType | "simple"): void;
	label: string;
	simple?: boolean;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const items: { value: TrackerType | "simple"; emoji: string; title: string; hint: string }[] = [
		...(simple
			? [
					{
						value: "simple" as const,
						emoji: kind === "break" ? "🛡️" : "✅",
						title: t.t("tracker.simple"),
						hint: t.t("tracker.simpleHint"),
					},
				]
			: []),
		...options.map((def) => ({
			value: def.type,
			emoji: def.emoji,
			title: trackerName(def.type, t),
			hint: trackerHint(def.type, t),
		})),
	];
	return (
		<View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.cards}>
			{items.map((item) => {
				const checked = item.value === value;
				return (
					<PressableScale
						key={item.value}
						onPress={() => {
							haptics.selection();
							onChange(item.value);
						}}
						scaleTo={0.98}
						accessibilityRole="radio"
						accessibilityState={{ selected: checked, checked }}
						accessibilityLabel={`${item.title}. ${item.hint}`}
						style={[
							styles.card,
							checked && { borderColor: colors.accent, backgroundColor: colors.accentSoft },
						]}
						testID={`tracker-option-${item.value}`}
					>
						<View style={[styles.cardEmoji, checked && { backgroundColor: colors.surface }]}>
							<Text style={styles.emoji} allowFontScaling={false}>
								{item.emoji}
							</Text>
						</View>
						<View style={styles.grow}>
							<Text variant="small" weight="semibold">
								{item.title}
							</Text>
							<Text variant="small" tone="muted">
								{item.hint}
							</Text>
						</View>
						{checked ? (
							<View style={[styles.check, { backgroundColor: colors.accent }]}>
								<Check size={13} color={colors.onAccent} strokeWidth={3} />
							</View>
						) : (
							<View style={[styles.check, styles.checkEmpty]} />
						)}
					</PressableScale>
				);
			})}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	section: { gap: 12 },
	heading: { gap: 2 },
	grow: { flex: 1 },
	cards: { gap: 8 },
	card: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	cardEmoji: {
		width: 40,
		height: 40,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	emoji: { fontSize: 20, lineHeight: 26 },
	check: {
		width: 22,
		height: 22,
		borderRadius: 11,
		alignItems: "center",
		justifyContent: "center",
	},
	checkEmpty: { borderWidth: 1.5, borderColor: t.colors.borderStrong },
	settings: {
		gap: 18,
		padding: 16,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	hint: { flexDirection: "row", gap: 8 },
}));
