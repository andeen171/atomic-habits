import { Clock, X } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { useState } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { Button } from "./button";
import { Text } from "./text";

export interface TimeFieldProps {
	/** "HH:MM" (24-hour) or null. */
	value: string | null;
	onChange: (value: string | null) => void;
	/** Visible label above the field; also its accessible name. */
	label?: string;
	/** Accessible name when there is no visible label. */
	accessibilityLabel?: string;
	/** Shown while empty (defaults to "No time"). */
	placeholder?: string;
	/** Offer an ✕ that clears the value (default true). */
	clearable?: boolean;
	/** Minute grid step (default 5). */
	minuteStep?: 1 | 5 | 15;
	/** Where the picker starts when empty (default "07:00"). */
	defaultTime?: string;
	disabled?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function split(value: string | null | undefined): [number, number] | null {
	const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
	if (!match) return null;
	const h = Number(match[1]);
	const m = Number(match[2]);
	return h < 24 && m < 60 ? [h, m] : null;
}

/**
 * A time of day: a field that opens an hour / minute grid in a sheet
 * (tracker clock fields, journal "when" prompts, task times). Every cell is
 * a radio with its own label; the sheet's button states the chosen time.
 */
export function TimeField({
	value,
	onChange,
	label,
	accessibilityLabel,
	placeholder,
	clearable = true,
	minuteStep = 5,
	defaultTime = "07:00",
	disabled,
	style,
	testID,
}: TimeFieldProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	const [hour, setHour] = useState(7);
	const [minute, setMinute] = useState(0);
	const minutes = Array.from({ length: 60 / minuteStep }, (_, i) => i * minuteStep);
	const empty = placeholder ?? t.x("editor.noTime");
	const name = accessibilityLabel ?? label ?? t.x("editor.pickTime");

	const show = () => {
		const [h, m] = split(value) ?? split(defaultTime) ?? [7, 0];
		setHour(h);
		setMinute(m);
		setOpen(true);
	};

	return (
		<View style={style}>
			{label ? (
				<Text variant="small" weight="medium" tone="muted" style={styles.label}>
					{label}
				</Text>
			) : null}
			<View style={[styles.field, disabled && { opacity: 0.5 }]}>
				<Pressable
					onPress={show}
					disabled={disabled}
					accessibilityRole="button"
					accessibilityLabel={`${name}: ${value ?? empty}`}
					accessibilityState={{ disabled: Boolean(disabled) }}
					style={styles.main}
					testID={testID}
				>
					<Clock size={18} color={value ? colors.accent : colors.textSubtle} />
					<Text weight={value ? "semibold" : "regular"} tone={value ? "default" : "subtle"} tabular>
						{value ?? empty}
					</Text>
				</Pressable>
				{value && clearable && !disabled ? (
					<Pressable
						onPress={() => {
							haptics.selection();
							onChange(null);
						}}
						hitSlop={10}
						style={styles.clear}
						accessibilityRole="button"
						accessibilityLabel={`${t.x("editor.clear")}: ${name}`}
					>
						<X size={16} color={colors.textMuted} />
					</Pressable>
				) : null}
			</View>
			<Sheet
				open={open}
				onClose={() => setOpen(false)}
				title={label ?? t.x("editor.pickTime")}
				footer={
					<Button
						label={`${t.t("common.done")} · ${pad(hour)}:${pad(minute)}`}
						size="lg"
						onPress={() => {
							onChange(`${pad(hour)}:${pad(minute)}`);
							setOpen(false);
						}}
						testID={testID ? `${testID}-done` : undefined}
					/>
				}
			>
				<Text variant="label" style={styles.gridLabel}>
					{t.x("editor.hour")}
				</Text>
				<View
					style={styles.grid}
					accessibilityRole="radiogroup"
					accessibilityLabel={t.x("editor.hour")}
				>
					{HOURS.map((h) => (
						<Cell key={h} label={pad(h)} selected={h === hour} onPress={() => setHour(h)} />
					))}
				</View>
				<Text variant="label" style={[styles.gridLabel, { marginTop: 16 }]}>
					{t.x("editor.minute")}
				</Text>
				<View
					style={[styles.grid, { marginBottom: 8 }]}
					accessibilityRole="radiogroup"
					accessibilityLabel={t.x("editor.minute")}
				>
					{minutes.map((m) => (
						<Cell
							key={m}
							label={`:${pad(m)}`}
							selected={m === minute}
							onPress={() => setMinute(m)}
							narrow={minuteStep === 1}
						/>
					))}
				</View>
			</Sheet>
		</View>
	);
}

function Cell({
	label,
	selected,
	onPress,
	narrow,
}: { label: string; selected: boolean; onPress: () => void; narrow?: boolean }) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Pressable
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			accessibilityRole="radio"
			accessibilityState={{ selected }}
			accessibilityLabel={label}
			style={[
				styles.cell,
				narrow && styles.cellNarrow,
				selected && { backgroundColor: colors.text },
			]}
		>
			<Text
				variant="small"
				weight={selected ? "bold" : "medium"}
				tabular
				color={selected ? colors.bg : colors.text}
			>
				{label}
			</Text>
		</Pressable>
	);
}

const useStyles = makeStyles((t) => ({
	label: { marginBottom: 6 },
	field: {
		flexDirection: "row",
		alignItems: "center",
		minHeight: 48,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	main: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 48,
		paddingHorizontal: 14,
	},
	clear: { paddingHorizontal: 14, minHeight: 48, justifyContent: "center" },
	gridLabel: { marginBottom: 8 },
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	cell: {
		width: "15%",
		flexGrow: 1,
		height: 44,
		borderRadius: 10,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	cellNarrow: { width: "9%" },
}));
