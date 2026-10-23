import { Minus, Plus } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { NumberField } from "@/components/ui/number-field";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { LOG_AMOUNT_MAX, amountLabel, useHabitLog } from "@/lib/use-habit-log";
import {
	type DayKey,
	type Habit,
	MONTH_DAY_CAP,
	canExceedTarget,
	getLog,
	monthAmount,
	targetOn,
} from "@atomic/core";
import { useAtomic, useText, useToday } from "@atomic/core/react";
import { useEffect, useRef, useState } from "react";
import { Platform, type TextInput, View } from "react-native";
import { displayHabit } from "./display-habit";
import { HabitRing } from "./habit-ring";

export interface LogAmountSheetProps {
	habit: Habit | undefined;
	day: DayKey | undefined;
	open: boolean;
	onClose: () => void;
	/** After the exit animation (e.g. to open another sheet). */
	onClosed?: () => void;
}

/** Selects the field's text so typing replaces the current amount. */
function selectAll(input: TextInput | null, length: number) {
	if (!input) return;
	input.focus();
	if (Platform.OS === "web") {
		(input as unknown as { select?: () => void }).select?.();
		return;
	}
	(input as unknown as { setSelection?: (start: number, end: number) => void }).setSelection?.(
		0,
		length,
	);
}

/**
 * "Log amount…" (spec §6, D11): set a day's count directly, 0–10,000, with a
 * live ring preview and the month cap as the hint ("Up to 20 pages count
 * toward this month's goal."). Saving shows an Undo toast.
 */
export function LogAmountSheet({ habit, day, open, onClose, onClosed }: LogAmountSheetProps) {
	const t = useT();
	const styles = useStyles();
	const text = useText();
	const today = useToday();
	const { logAmount } = useHabitLog();
	const current = useAtomic((s) => (habit && day ? (getLog(s, habit.id, day)?.count ?? 0) : 0));
	const [value, setValue] = useState<number | null>(current);
	const inputRef = useRef<TextInput>(null);

	// Each opening starts from the day's count, focused and selected once the sheet is up.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only.
	useEffect(() => {
		if (!open) return;
		setValue(current);
		const timer = setTimeout(() => selectAll(inputRef.current, String(current).length), 320);
		return () => clearTimeout(timer);
	}, [open, habit?.id, day]);

	if (!habit || !day) return <Sheet open={false} onClose={onClose} onClosed={onClosed} />;

	const target = targetOn(habit, day);
	const shown = displayHabit(habit, text);
	const amount = value ?? 0;
	const name = text.habit(habit, "name");
	const label = t.t("habit.logAmountLabel", { date: t.formatDayShort(day) });
	const bump = (delta: 1 | -1) => {
		const next = Math.max(0, Math.min(LOG_AMOUNT_MAX, amount + delta));
		if (next === amount) return;
		haptics.selection();
		setValue(next);
	};
	const save = () => {
		logAmount(habit, day, amount);
		onClose();
	};

	return (
		<Sheet
			open={open}
			onClose={onClose}
			onClosed={onClosed}
			title={t.t("habit.logAmountTitle", { habit: name })}
			subtitle={t.formatRelativeDay(day, today)}
			closeButton
			testID="log-amount-sheet"
			footer={
				<Button
					label={t.t("common.save")}
					size="lg"
					fullWidth
					onPress={save}
					testID="log-amount-save"
				/>
			}
		>
			<View style={styles.body}>
				<View
					style={styles.preview}
					accessible
					accessibilityLiveRegion="polite"
					accessibilityLabel={`${name}, ${amountLabel(shown, amount, t)}`}
				>
					<View
						pointerEvents="none"
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
					>
						<HabitRing
							habit={habit}
							count={amount}
							progress={Math.min(1, amount / Math.max(1, target))}
							state={amount >= target ? "done" : amount > 0 ? "partial" : "pending"}
							extra={Math.max(0, amount - target)}
							showVotes={false}
							size={40}
						/>
					</View>
					<View style={styles.previewText}>
						<Text weight="medium" numberOfLines={1}>
							{name}
						</Text>
						<Text variant="small" tone="muted" tabular numberOfLines={1}>
							{amountLabel(shown, amount, t)}
						</Text>
					</View>
				</View>
				<View style={styles.field}>
					<Text variant="small" weight="medium" tone="muted">
						{label}
					</Text>
					<View style={styles.stepper}>
						<IconButton
							icon={Minus}
							variant="soft"
							size={48}
							accessibilityLabel={t.t("habit.decrement")}
							disabled={amount <= 0}
							onPress={() => bump(-1)}
						/>
						<NumberField
							ref={inputRef}
							value={value}
							onChange={setValue}
							accessibilityLabel={label}
							min={0}
							max={LOG_AMOUNT_MAX}
							unit={shown.unit ?? undefined}
							size="lg"
							onSubmitEditing={save}
							containerStyle={styles.input}
							testID="log-amount-field"
						/>
						<IconButton
							icon={Plus}
							variant="soft"
							size={48}
							accessibilityLabel={t.t("habit.increment")}
							disabled={amount >= LOG_AMOUNT_MAX}
							onPress={() => bump(1)}
						/>
					</View>
					{canExceedTarget(habit) ? (
						<Text variant="small" tone="muted">
							{t.t("habit.logAmountHint", {
								cap: monthAmount(shown, MONTH_DAY_CAP * target, t),
							})}
						</Text>
					) : null}
				</View>
			</View>
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 18, paddingBottom: 6 },
	preview: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.sunken,
	},
	previewText: { flex: 1, gap: 1 },
	field: { gap: 8 },
	stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
	input: { flex: 1 },
}));
