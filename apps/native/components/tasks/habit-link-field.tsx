import { Check, ChevronRight, Orbit } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import type { Habit } from "@atomic/core";
import { useHabit, useHabits, useText } from "@atomic/core/react";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";

interface HabitLinkFieldProps {
	/** The linked habit's id, or null. */
	value: string | null;
	onChange(habitId: string | null): void;
	disabled?: boolean;
}

/**
 * Which habit a task helps form (Annex T §5.3): a field that opens a sheet
 * with "Not linked" and the live, non-archived habits. A link to an
 * archived habit (a paused setup task) stays listed so the current choice
 * is always visible.
 */
export function HabitLinkField({ value, onChange, disabled }: HabitLinkFieldProps) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	const habits = useHabits();
	const current = useHabit(value ?? undefined);
	const options = current && !habits.includes(current) ? [current, ...habits] : habits;
	const name = current ? text.habit(current, "name") : null;

	const pick = (habitId: string | null) => {
		haptics.selection();
		if (habitId !== value) onChange(habitId);
		setOpen(false);
	};

	return (
		<>
			<Pressable
				onPress={() => {
					haptics.selection();
					setOpen(true);
				}}
				disabled={disabled}
				accessibilityRole="button"
				accessibilityLabel={`${t.t("tasks.habit")}: ${name ?? t.t("tasks.habitNone")}`}
				accessibilityState={{ disabled: Boolean(disabled) }}
				style={({ pressed }) => [
					styles.field,
					pressed && { backgroundColor: colors.hover },
					disabled && { opacity: 0.6 },
				]}
				testID="habit-link"
			>
				{current ? (
					<HabitEmoji habit={current} />
				) : (
					<Orbit size={18} color={colors.textSubtle} strokeWidth={1.9} />
				)}
				<Text
					weight={current ? "semibold" : "regular"}
					tone={current ? "default" : "muted"}
					numberOfLines={1}
					style={styles.value}
				>
					{name ?? t.t("tasks.habitNone")}
				</Text>
				<ChevronRight size={18} color={colors.textSubtle} />
			</Pressable>
			<Sheet open={open} onClose={() => setOpen(false)} title={t.t("tasks.habit")} scroll>
				<View
					accessibilityRole="radiogroup"
					accessibilityLabel={t.t("tasks.habit")}
					style={styles.list}
				>
					<LinkRow
						selected={value === null}
						label={t.t("tasks.habitNone")}
						leading={
							<View style={[styles.emojiTile, { backgroundColor: colors.sunken }]}>
								<Orbit size={18} color={colors.textMuted} strokeWidth={1.9} />
							</View>
						}
						onPress={() => pick(null)}
						testID="habit-link-none"
					/>
					{options.map((habit) => (
						<LinkRow
							key={habit.id}
							selected={habit.id === value}
							label={text.habit(habit, "name")}
							leading={<HabitEmoji habit={habit} tile />}
							onPress={() => pick(habit.id)}
							testID={`habit-link-${habit.id}`}
						/>
					))}
				</View>
			</Sheet>
		</>
	);
}

function HabitEmoji({ habit, tile }: { habit: Habit; tile?: boolean }) {
	const theme = useTheme();
	const styles = useStyles();
	const emoji = (
		<Text style={tile ? styles.emojiLarge : styles.emoji} accessible={false}>
			{habit.emoji}
		</Text>
	);
	if (!tile) return emoji;
	return (
		<View style={[styles.emojiTile, { backgroundColor: theme.habit(habit.color).soft }]}>
			{emoji}
		</View>
	);
}

function LinkRow({
	label,
	leading,
	selected,
	onPress,
	testID,
}: {
	label: string;
	leading: ReactNode;
	selected: boolean;
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
			accessibilityLabel={label}
			style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}
			testID={testID}
		>
			{leading}
			<Text weight={selected ? "semibold" : "medium"} numberOfLines={2} style={styles.value}>
				{label}
			</Text>
			{selected ? <Check size={20} color={colors.accentText} strokeWidth={2.4} /> : null}
		</Pressable>
	);
}

const useStyles = makeStyles((t) => ({
	field: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 48,
		paddingHorizontal: 14,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	value: { flex: 1 },
	emoji: { fontSize: 17, lineHeight: 22 },
	emojiLarge: { fontSize: 19, lineHeight: 24 },
	emojiTile: {
		width: 36,
		height: 36,
		borderRadius: 11,
		alignItems: "center",
		justifyContent: "center",
	},
	list: { marginHorizontal: -8, paddingBottom: 8 },
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		minHeight: 54,
		paddingHorizontal: 8,
		borderRadius: t.radii.md,
	},
}));
