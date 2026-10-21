import { CalendarDays, Check, ChevronLeft, ChevronRight } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { NumberField } from "@/components/ui/number-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type AnyRepeat,
	type DayKey,
	type RepeatRule,
	type RepeatUnit,
	type Task,
	type TaskLog,
	type Weekday,
	addMonths,
	capitalize,
	isKnownRule,
	maxDay,
	nextDatesLabel,
	orderedWeekdays,
	presetKeyOf,
	presetLabel,
	repeatLabel,
	repeatPresets,
	upcomingOccurrences,
	weekdayOf,
} from "@atomic/core";
import { useToday } from "@atomic/core/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { DatePickerSheet } from "./task-fields";
import { dateLabel } from "./task-row";

type EndChoice = "never" | "on" | "after";
type Mode = "schedule" | "after";

const MAX_EVERY: Record<RepeatUnit, number> = { days: 365, weeks: 52, months: 120 };
const DEFAULT_COUNT = 10;

const dayOfMonth = (day: DayKey) => Number(day.slice(8, 10));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** A throwaway series for previews: the rule on `start`, with the edited task's logs if any. */
function previewSeries(rule: RepeatRule, start: DayKey, base?: Task): Task {
	// Only id, date, createdAt, repeat and completedAt are read (`upcomingOccurrences`).
	return {
		...(base ?? ({ id: "preview", createdAt: 0, habitId: null } as unknown as Task)),
		repeat: rule,
		date: start,
		completedAt: null,
	};
}

/** The next `n` dates a rule gives from `start` ("Next: Oct 14, Oct 15, Oct 16"). */
export function useNextDates(
	rule: AnyRepeat | null,
	start: DayKey,
	opts: { task?: Task; logs?: readonly TaskLog[]; n?: number } = {},
): DayKey[] {
	const today = useToday();
	const { task, logs, n = 3 } = opts;
	return useMemo(() => {
		if (!isKnownRule(rule)) return [];
		return upcomingOccurrences(previewSeries(rule, start, task), logs ?? [], today, n);
	}, [rule, start, task, logs, today, n]);
}

/** An extra choice above the presets (setup tasks: "Same days as the habit"). */
export interface ExtraRepeatPreset {
	key: string;
	label: string;
	rule: RepeatRule;
}

export interface RepeatSheetProps {
	open: boolean;
	onClose(): void;
	value: AnyRepeat | null;
	onChange(rule: RepeatRule | null): void;
	/** The series start: presets are relative to it, and it anchors the preview. */
	start: DayKey;
	weekStartsOn: Weekday;
	/** The series being edited, so the preview starts from its open occurrence. */
	task?: Task;
	logs?: readonly TaskLog[];
	extra?: readonly ExtraRepeatPreset[];
}

/**
 * The repeat picker (Annex T §5.2). The first page lists the presets
 * relative to the start ("Weekly on Tue", "Monthly on the 20th", "Every
 * year on Oct 20") as radio rows; a tap applies and closes. "Custom…"
 * drills into the rule editor (mode, every + unit, weekdays, day of the
 * month, ends) with a live preview of the next dates, applied on Done.
 */
export function RepeatSheet({
	open,
	onClose,
	value,
	onChange,
	start,
	weekStartsOn,
	task,
	logs,
	extra,
}: RepeatSheetProps) {
	const t = useT();
	const ws = weekStartsOn === 0 ? 0 : 1;
	const presets = useMemo(() => repeatPresets(start, ws), [start, ws]);
	const known = isKnownRule(value) ? value : null;
	const presetKey = presetKeyOf(value, start);
	const weekly = presets.find((p) => p.key === "weekly")?.rule ?? null;
	const [page, setPage] = useState<"presets" | "custom">("presets");
	const [draft, setDraft] = useState<RepeatRule | null>(known ?? weekly);
	const next = useNextDates(draft, start, { task, logs });
	const extraMatch = extra?.find((e) => JSON.stringify(e.rule) === JSON.stringify(known));

	// Each opening starts on the presets, from the current rule.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
	useEffect(() => {
		if (!open) return;
		setPage("presets");
		setDraft(known ?? weekly);
	}, [open]);

	const pick = (rule: RepeatRule | null) => {
		haptics.selection();
		onChange(rule);
		onClose();
	};

	const custom = page === "custom";
	return (
		<Sheet
			open={open}
			onClose={onClose}
			scroll
			title={custom ? t.t("repeat.customTitle") : t.t("repeat.label")}
			leading={
				custom ? (
					<IconButton
						icon={ChevronLeft}
						variant="soft"
						size={34}
						iconSize={18}
						accessibilityLabel={t.t("common.back")}
						onPress={() => setPage("presets")}
						testID="repeat-back"
					/>
				) : undefined
			}
			footer={
				custom ? (
					<Button
						label={t.t("common.done")}
						size="lg"
						disabled={!draft}
						onPress={() => {
							if (!draft) return;
							pick(draft);
						}}
						testID="repeat-done"
					/>
				) : undefined
			}
			testID="repeat-sheet"
		>
			{custom && draft ? (
				<Animated.View entering={FadeIn.duration(160)} key="custom">
					<RepeatEditor
						value={draft}
						onChange={setDraft}
						start={start}
						weekStartsOn={weekStartsOn}
						next={next}
					/>
				</Animated.View>
			) : (
				<Animated.View
					entering={FadeIn.duration(160)}
					key="presets"
					accessibilityRole="radiogroup"
					accessibilityLabel={t.t("repeat.label")}
					style={{ paddingBottom: 8 }}
				>
					{extra?.map((preset) => (
						<OptionRow
							key={preset.key}
							label={preset.label}
							selected={extraMatch?.key === preset.key}
							onPress={() => pick(preset.rule)}
							testID={`repeat-preset-${preset.key}`}
						/>
					))}
					{presets.map((preset) => (
						<OptionRow
							key={preset.key}
							label={presetLabel(preset, t, start, weekStartsOn)}
							selected={!extraMatch && presetKey === preset.key}
							onPress={() => pick(preset.rule)}
							testID={`repeat-preset-${preset.key}`}
						/>
					))}
					<OptionRow
						label={t.t("repeat.custom")}
						hint={
							presetKey === "custom" && !extraMatch && value
								? repeatLabel(value, t, { start, weekStartsOn })
								: undefined
						}
						selected={presetKey === "custom" && !extraMatch}
						chevron
						onPress={() => {
							haptics.selection();
							setDraft(known ?? weekly);
							setPage("custom");
						}}
						testID="repeat-preset-custom"
					/>
				</Animated.View>
			)}
		</Sheet>
	);
}

/** A radio row: label, optional hint, a check when selected (and a chevron for drill-ins). */
function OptionRow({
	label,
	hint,
	selected,
	chevron,
	onPress,
	testID,
}: {
	label: string;
	hint?: string;
	selected: boolean;
	chevron?: boolean;
	onPress(): void;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="radio"
			accessibilityState={{ selected }}
			accessibilityLabel={hint ? `${label}, ${hint}` : label}
			style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.hover }]}
			testID={testID}
		>
			<View style={styles.optionText}>
				<Text weight={selected ? "semibold" : "medium"}>{label}</Text>
				{hint ? (
					<Text variant="small" tone="muted">
						{hint}
					</Text>
				) : null}
			</View>
			{selected ? <Check size={20} color={colors.accentText} strokeWidth={2.4} /> : null}
			{chevron ? <ChevronRight size={18} color={colors.textSubtle} /> : null}
		</Pressable>
	);
}

interface RepeatEditorProps {
	value: RepeatRule;
	onChange(rule: RepeatRule): void;
	start: DayKey;
	weekStartsOn: Weekday;
	/** The next dates under this rule (`useNextDates`). */
	next: readonly DayKey[];
}

/**
 * The custom rule editor: mode, every + unit, weekdays (at least one stays
 * on), day of the month (29–31 clamp to the month's last day), ends (never,
 * on a date, after N times) and a live summary with the next dates. Unknown
 * keys of the current rule (a newer client's, `endedAt`) are kept while its
 * type stays the same.
 */
export function RepeatEditor({ value, onChange, start, weekStartsOn, next }: RepeatEditorProps) {
	const t = useT();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const [picking, setPicking] = useState(false);
	const mode: Mode = value.type === "after" ? "after" : "schedule";
	const unit: RepeatUnit = value.type === "after" ? (value.unit ?? "days") : value.type;
	const every = Math.max(1, Math.floor(value.every ?? 1));
	const ends: EndChoice = value.until ? "on" : value.count != null ? "after" : "never";
	// What the other units and end choices last held, so switching back restores it.
	const memory = useRef<{ days: Weekday[]; day: number; until: DayKey; count: number }>({
		days: value.type === "weeks" ? ([...value.days] as Weekday[]) : [weekdayOf(start)],
		day: value.type === "months" ? value.day : dayOfMonth(start),
		until: value.until ?? addMonths(maxDay(start, today), 1),
		count: value.count ?? DEFAULT_COUNT,
	});
	if (value.type === "weeks") memory.current.days = [...value.days] as Weekday[];
	if (value.type === "months") memory.current.day = value.day;
	if (value.until) memory.current.until = value.until;
	if (value.count != null) memory.current.count = value.count;

	const build = (
		changes: Partial<{ mode: Mode; unit: RepeatUnit; every: number; ends: EndChoice }> = {},
	): RepeatRule => {
		const m = changes.mode ?? mode;
		const u = changes.unit ?? unit;
		const e = changes.ends ?? ends;
		const end = {
			until: e === "on" ? memory.current.until : null,
			count: e === "after" ? memory.current.count : null,
		};
		const type = m === "after" ? "after" : u;
		const keep = (value.type === type ? value : {}) as Record<string, unknown>;
		const n = clamp(changes.every ?? every, 1, m === "after" ? 365 : MAX_EVERY[u]);
		if (m === "after") return { ...keep, type: "after", every: n, unit: u, ...end } as RepeatRule;
		if (u === "days") return { ...keep, type: "days", every: n, ...end } as RepeatRule;
		if (u === "weeks") {
			return {
				...keep,
				type: "weeks",
				every: n,
				days: memory.current.days,
				weekStart: (keep.weekStart as 0 | 1 | undefined) ?? (weekStartsOn === 0 ? 0 : 1),
				...end,
			} as RepeatRule;
		}
		return { ...keep, type: "months", every: n, day: memory.current.day, ...end } as RepeatRule;
	};

	const weeks = mode === "schedule" && unit === "weeks";
	const months = mode === "schedule" && unit === "months";
	const maxEvery = mode === "after" ? 365 : MAX_EVERY[unit];

	return (
		<View style={styles.editor}>
			<SegmentedControl<Mode>
				accessibilityLabel={t.t("repeat.label")}
				value={mode}
				onChange={(m) => onChange(build({ mode: m }))}
				segments={[
					{ value: "schedule", label: t.t("repeat.mode.schedule") },
					{ value: "after", label: t.t("repeat.mode.after") },
				]}
			/>
			<View style={styles.section}>
				<Text variant="label">{t.t("repeat.every")}</Text>
				<NumberField
					value={every}
					onChange={(n) => {
						if (n != null && n >= 1) onChange(build({ every: n }));
					}}
					accessibilityLabel={t.t("repeat.every")}
					min={1}
					max={maxEvery}
					step={1}
					containerStyle={styles.stepper}
					testID="repeat-every"
				/>
				<SegmentedControl<RepeatUnit>
					accessibilityLabel={t.t("repeat.every")}
					value={unit}
					onChange={(u) => onChange(build({ unit: u }))}
					segments={[
						{ value: "days", label: t.t("repeat.unit.days") },
						{ value: "weeks", label: t.t("repeat.unit.weeks") },
						{ value: "months", label: t.t("repeat.unit.months") },
					]}
				/>
			</View>
			{weeks ? (
				<View style={styles.section}>
					<Text variant="label">{t.t("repeat.onDays")}</Text>
					<ToggleGroup<Weekday>
						type="multiple"
						fill
						accessibilityLabel={t.t("repeat.onDays")}
						value={memory.current.days}
						onChange={(days) => {
							// At least one day stays on.
							if (!days.length) {
								haptics.warning();
								return;
							}
							memory.current.days = [...days].sort((a, b) => a - b);
							onChange(build());
						}}
						options={orderedWeekdays(weekStartsOn).map((day) => ({
							value: day,
							label: capitalize(t.weekdayName(day, "short")),
							accessibilityLabel: capitalize(t.weekdayName(day, "long")),
						}))}
						testID="repeat-weekday"
					/>
				</View>
			) : null}
			{months ? (
				<View style={styles.section}>
					<Text variant="label">{t.t("repeat.onDay")}</Text>
					<NumberField
						value={memory.current.day}
						onChange={(day) => {
							if (day == null || day < 1 || day > 31) return;
							memory.current.day = day;
							onChange(build());
						}}
						accessibilityLabel={t.t("repeat.onDay")}
						min={1}
						max={31}
						step={1}
						containerStyle={styles.stepper}
						testID="repeat-day"
					/>
					{memory.current.day >= 29 ? (
						<Text variant="small" tone="muted">
							{t.t("repeat.clampHint")}
						</Text>
					) : null}
				</View>
			) : null}
			<View style={styles.section}>
				<Text variant="label">{t.t("repeat.ends")}</Text>
				<ToggleGroup<EndChoice>
					type="single"
					accessibilityLabel={t.t("repeat.ends")}
					value={ends}
					onChange={(e) => onChange(build({ ends: e }))}
					options={[
						{ value: "never", label: t.t("repeat.ends.never") },
						{ value: "on", label: t.t("repeat.ends.on") },
						{ value: "after", label: t.t("repeat.ends.after") },
					]}
					testID="repeat-ends"
				/>
				{ends === "on" ? (
					<Pressable
						onPress={() => setPicking(true)}
						accessibilityRole="button"
						accessibilityLabel={`${t.t("repeat.ends.on")}: ${t.formatDayLong(memory.current.until)}`}
						style={styles.dateField}
						testID="repeat-until"
					>
						<CalendarDays size={18} color={colors.accent} />
						<Text weight="semibold">{dateLabel(memory.current.until, today, t)}</Text>
					</Pressable>
				) : null}
				{ends === "after" ? (
					<View style={styles.countRow}>
						<NumberField
							value={memory.current.count}
							onChange={(count) => {
								if (count == null || count < 1 || count > 999) return;
								memory.current.count = count;
								onChange(build());
							}}
							accessibilityLabel={`${t.t("repeat.count")} (${t.tp("repeat.timesUnit", memory.current.count)})`}
							min={1}
							max={999}
							step={1}
							containerStyle={styles.stepper}
							testID="repeat-count"
						/>
						<Text tone="muted" importantForAccessibility="no" accessibilityElementsHidden>
							{t.tp("repeat.timesUnit", memory.current.count)}
						</Text>
					</View>
				) : null}
			</View>
			<View style={styles.preview} accessibilityLiveRegion="polite" accessible>
				<Text variant="small" weight="semibold">
					{repeatLabel(value, t, { start, weekStartsOn })}
				</Text>
				<Text variant="small" tone="muted">
					{nextDatesLabel(next, t)}
				</Text>
			</View>
			<DatePickerSheet
				open={picking}
				value={memory.current.until}
				onClose={() => setPicking(false)}
				onPick={(day) => {
					memory.current.until = day;
					onChange(build());
					setPicking(false);
				}}
			/>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	option: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 52,
		paddingHorizontal: 12,
		paddingVertical: 8,
		marginHorizontal: -12,
		borderRadius: t.radii.md,
	},
	optionText: { flex: 1, gap: 1 },
	editor: { gap: 22, paddingBottom: 8 },
	section: { gap: 10 },
	stepper: { maxWidth: 200, flexGrow: 1 },
	countRow: { flexDirection: "row", alignItems: "center", gap: 12 },
	dateField: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 48,
		paddingHorizontal: 14,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
		alignSelf: "flex-start",
	},
	preview: {
		gap: 2,
		paddingTop: 14,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
}));
