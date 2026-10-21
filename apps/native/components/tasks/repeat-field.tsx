import { ChevronRight, Repeat } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type AnyRepeat,
	type DayKey,
	type RepeatRule,
	type Task,
	type TaskLog,
	type Weekday,
	isKnownRule,
	nextDatesLabel,
	repeatLabel,
} from "@atomic/core";
import { useState } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { type ExtraRepeatPreset, RepeatSheet, useNextDates } from "./repeat-sheet";

interface RepeatPickerProps {
	value: AnyRepeat | null;
	onChange(rule: RepeatRule | null): void;
	/** The series start: presets are relative to it, and it anchors the preview. */
	start: DayKey;
	weekStartsOn: Weekday;
	extra?: readonly ExtraRepeatPreset[];
}

/**
 * The compact repeat chip (quick add, composer; Annex T §5.2): "Repeat" or
 * the rule's short label, filled while a rule is set. Opens the repeat
 * sheet. Unlike `Chip`, a long label shrinks with an ellipsis, so it can
 * share a row with other controls.
 */
export function RepeatChip({
	value,
	onChange,
	start,
	weekStartsOn,
	extra,
	size = "md",
	noneLabel,
	style,
}: RepeatPickerProps & {
	size?: "sm" | "md";
	/** What the chip reads without a rule ("Once" for setup tasks); "Repeat" by default. */
	noneLabel?: string;
	style?: StyleProp<ViewStyle>;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	const label = value ? repeatLabel(value, t, { start, weekStartsOn, short: true }) : null;
	const selected = value != null;
	const fg = selected ? colors.bg : colors.text;
	return (
		<>
			<PressableScale
				onPress={() => {
					haptics.selection();
					setOpen(true);
				}}
				scaleTo={0.95}
				hitSlop={size === "sm" ? 7 : 4}
				accessibilityRole="button"
				accessibilityLabel={`${t.t("repeat.label")}: ${label ?? noneLabel ?? t.t("repeat.none")}`}
				style={[
					styles.chip,
					size === "sm" ? styles.chipSm : styles.chipMd,
					{
						backgroundColor: selected ? colors.text : colors.surface,
						borderColor: selected ? colors.text : colors.border,
					},
					style,
				]}
				testID="repeat-chip"
			>
				<Repeat size={size === "sm" ? 14 : 16} color={fg} strokeWidth={2} />
				<Text variant="small" weight="medium" color={fg} numberOfLines={2} style={styles.chipText}>
					{label ?? noneLabel ?? t.t("repeat.label")}
				</Text>
			</PressableScale>
			<RepeatSheet
				open={open}
				onClose={() => setOpen(false)}
				value={value}
				onChange={onChange}
				start={start}
				weekStartsOn={weekStartsOn}
				extra={extra}
			/>
		</>
	);
}

/**
 * The task sheet's repeat field: "Every day ›" in a tappable field that
 * opens the repeat sheet, with the next three dates under it. Read-only for
 * a rule from a newer version of Atomic.
 */
export function RepeatRow({
	value,
	onChange,
	start,
	weekStartsOn,
	disabled,
	task,
	logs,
	extra,
}: RepeatPickerProps & {
	disabled?: boolean;
	/** The series being edited, so the preview starts from its open occurrence. */
	task?: Task;
	logs?: readonly TaskLog[];
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	const known = isKnownRule(value) ? value : null;
	const next = useNextDates(known, start, { task, logs });
	const label = value ? repeatLabel(value, t, { start, weekStartsOn }) : t.t("repeat.none");
	const preview = known ? nextDatesLabel(next, t) : "";
	return (
		<View style={styles.wrap}>
			<Pressable
				onPress={() => {
					haptics.selection();
					setOpen(true);
				}}
				disabled={disabled}
				accessibilityRole="button"
				accessibilityLabel={`${t.t("repeat.label")}: ${label}`}
				accessibilityState={{ disabled: Boolean(disabled) }}
				style={({ pressed }) => [
					styles.field,
					pressed && { backgroundColor: colors.hover },
					disabled && styles.disabled,
				]}
				testID="repeat-row"
			>
				<Repeat size={18} color={known ? colors.accent : colors.textSubtle} />
				<Text
					weight={known ? "semibold" : "regular"}
					tone={known ? "default" : "muted"}
					style={styles.value}
				>
					{label}
				</Text>
				{disabled ? null : <ChevronRight size={18} color={colors.textSubtle} />}
			</Pressable>
			{/* Always mounted so screen readers hear the dates change (start date, rule). */}
			<Text
				variant="small"
				tone="muted"
				accessibilityLiveRegion="polite"
				style={preview ? undefined : styles.hidden}
			>
				{preview}
			</Text>
			<RepeatSheet
				open={open}
				onClose={() => setOpen(false)}
				value={value}
				onChange={onChange}
				start={start}
				weekStartsOn={weekStartsOn}
				task={task}
				logs={logs}
				extra={extra}
			/>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	chip: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		gap: 6,
		maxWidth: "100%",
		borderWidth: 1,
	},
	// Two lines at most for very long rules ("Every 2 weeks on Mon · Tue · Thu · Fri").
	chipSm: { minHeight: 30, paddingHorizontal: 11, paddingVertical: 4, borderRadius: 15 },
	chipMd: { minHeight: 36, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 18 },
	chipText: { flexShrink: 1 },
	wrap: { gap: 6 },
	field: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 48,
		paddingHorizontal: 14,
		paddingVertical: 10,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	value: { flex: 1 },
	disabled: { opacity: 0.6 },
	hidden: { display: "none" },
}));
