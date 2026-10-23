import { CalendarMonth } from "@/components/calendar-month";
import { CalendarDays, Flag } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Chip } from "@/components/ui/chip";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { type Theme, makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { type DayKey, type TaskPriority, addDays, startOfMonth } from "@atomic/core";
import { useToday } from "@atomic/core/react";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

export function priorityColor(priority: TaskPriority, theme: Theme): string {
	if (priority === 3) return theme.colors.danger;
	if (priority === 2) return theme.colors.warning;
	if (priority === 1) return theme.habit("sky").text;
	return theme.colors.textSubtle;
}

/** Today / Tomorrow / Someday / Pick a date, then `trailing` (the repeat chip). */
export function DateChips({
	value,
	onChange,
	size = "md",
	bleed = 0,
	trailing,
	somedayDisabled,
}: {
	value: DayKey | null;
	onChange: (day: DayKey | null) => void;
	size?: "sm" | "md";
	/** Let the scroller run to the container edges (sheets with side padding). */
	bleed?: number;
	/** Extra chips after the date chips, behind a hairline (e.g. `RepeatChip`). */
	trailing?: ReactNode;
	/** A repeating task needs a start date: Someday stays visible but says why it can't be picked. */
	somedayDisabled?: boolean;
}) {
	const t = useT();
	const today = useToday();
	const tomorrow = addDays(today, 1);
	const [picking, setPicking] = useState(false);
	const custom = value !== null && value !== today && value !== tomorrow;
	const styles = useStyles();
	return (
		<>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={bleed ? { marginHorizontal: -bleed } : undefined}
				contentContainerStyle={{ gap: 8, paddingRight: 8 + bleed, paddingLeft: bleed }}
				keyboardShouldPersistTaps="always"
			>
				<Chip
					size={size}
					label={t.t("tasks.date.today")}
					selected={value === today}
					onPress={() => onChange(today)}
				/>
				<Chip
					size={size}
					label={t.t("tasks.date.tomorrow")}
					selected={value === tomorrow}
					onPress={() => onChange(tomorrow)}
				/>
				<Chip
					size={size}
					label={t.t("tasks.date.someday")}
					selected={!somedayDisabled && value === null}
					onPress={() => {
						if (!somedayDisabled) {
							onChange(null);
							return;
						}
						haptics.warning();
						showToast(t.t("repeat.needsDate"));
					}}
					accessibilityLabel={
						somedayDisabled ? `${t.t("tasks.date.someday")}. ${t.t("repeat.needsDate")}` : undefined
					}
					style={somedayDisabled ? styles.chipDisabled : undefined}
					testID="date-chip-someday"
				/>
				<Chip
					size={size}
					icon={CalendarDays}
					label={
						custom && value ? t.formatDayShort(value) : size === "sm" ? "" : t.t("tasks.date.pick")
					}
					accessibilityLabel={custom && value ? t.formatDayLong(value) : t.t("tasks.date.pick")}
					selected={custom}
					onPress={() => setPicking(true)}
				/>
				{trailing ? (
					<>
						<View style={[styles.divider, size === "sm" && styles.dividerSm]} />
						{trailing}
					</>
				) : null}
			</ScrollView>
			<DatePickerSheet
				open={picking}
				value={value}
				onClose={() => setPicking(false)}
				onPick={(day) => {
					onChange(day);
					setPicking(false);
				}}
			/>
		</>
	);
}

export function DatePickerSheet({
	open,
	value,
	onPick,
	onClose,
}: {
	open: boolean;
	value: DayKey | null;
	onPick: (day: DayKey) => void;
	onClose: () => void;
}) {
	const t = useT();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const [month, setMonth] = useState(startOfMonth(value ?? today));
	return (
		<Sheet open={open} onClose={onClose} title={t.t("tasks.date.pick")}>
			<CalendarMonth
				month={month}
				onMonthChange={setMonth}
				renderDay={(day, inMonth) => {
					const selected = day === value;
					const isToday = day === today;
					return (
						<Pressable
							onPress={() => {
								haptics.selection();
								onPick(day);
							}}
							accessibilityRole="button"
							accessibilityState={{ selected }}
							accessibilityLabel={t.formatDayLong(day)}
							style={[
								styles.day,
								selected && { backgroundColor: colors.text },
								!selected && isToday && { borderColor: colors.accent, borderWidth: 1.5 },
							]}
						>
							<Text
								variant="small"
								weight={selected || isToday ? "semibold" : "regular"}
								tabular
								color={selected ? colors.bg : isToday ? colors.accentText : undefined}
								tone={inMonth ? "default" : "subtle"}
							>
								{Number(day.slice(8))}
							</Text>
						</Pressable>
					);
				}}
			/>
		</Sheet>
	);
}

/** Four flags: none / low / medium / high. */
export function PriorityPicker({
	value,
	onChange,
	compact,
}: {
	value: TaskPriority;
	onChange: (value: TaskPriority) => void;
	compact?: boolean;
}) {
	const t = useT();
	const theme = useTheme();
	const styles = useStyles();
	const options: TaskPriority[] = [0, 1, 2, 3];
	return (
		<View
			style={styles.flags}
			accessibilityRole="radiogroup"
			accessibilityLabel={t.t("tasks.priority")}
		>
			{options.map((p) => {
				const selected = value === p;
				const color = priorityColor(p, theme);
				const label = t.t(`tasks.priority.${p}`);
				return (
					<Pressable
						key={p}
						onPress={() => {
							haptics.selection();
							onChange(p);
						}}
						accessibilityRole="radio"
						accessibilityState={{ selected }}
						accessibilityLabel={t.x("a11y.priority", { priority: label })}
						hitSlop={4}
						style={[
							styles.flag,
							compact && styles.flagCompact,
							{
								backgroundColor: selected ? theme.colors.sunken : "transparent",
								borderColor: selected ? theme.colors.borderStrong : theme.colors.border,
							},
						]}
					>
						<Flag
							size={15}
							color={color}
							fill={p > 0 && selected ? color : "transparent"}
							strokeWidth={2.2}
						/>
						{compact ? null : (
							<Text
								variant="small"
								weight={selected ? "semibold" : "medium"}
								tone={selected ? "default" : "muted"}
							>
								{label}
							</Text>
						)}
					</Pressable>
				);
			})}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	day: {
		width: 40,
		height: 40,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",
	},
	flags: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
	flag: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		height: 36,
		paddingHorizontal: 12,
		borderRadius: t.radii.md,
		borderWidth: 1,
	},
	flagCompact: { width: 40, paddingHorizontal: 0, justifyContent: "center" },
	chipDisabled: { opacity: 0.45 },
	divider: {
		width: 1,
		height: 22,
		alignSelf: "center",
		marginHorizontal: 2,
		backgroundColor: t.colors.border,
	},
	dividerSm: { height: 18 },
}));
