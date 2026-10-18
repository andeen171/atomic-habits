import { Minus, Plus } from "@/components/icons";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { View } from "react-native";
import { IconButton } from "./icon-button";
import { Text } from "./text";

export interface StepperProps {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	/** Rendered value (defaults to the localized number). */
	format?: (value: number) => string;
	accessibilityLabel: string;
}

export function Stepper({
	value,
	onChange,
	min = 0,
	max = 10_000,
	step = 1,
	format,
	accessibilityLabel,
}: StepperProps) {
	const t = useT();
	const styles = useStyles();
	const set = (next: number) => {
		const clamped = Math.max(min, Math.min(max, next));
		if (clamped !== value) {
			haptics.selection();
			onChange(clamped);
		}
	};
	return (
		<View
			style={styles.row}
			accessible
			accessibilityRole="adjustable"
			accessibilityLabel={accessibilityLabel}
			accessibilityValue={{ min, max, now: value, text: format ? format(value) : t.number(value) }}
			accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
			onAccessibilityAction={(event) => {
				if (event.nativeEvent.actionName === "increment") set(value + step);
				if (event.nativeEvent.actionName === "decrement") set(value - step);
			}}
		>
			<IconButton
				icon={Minus}
				variant="soft"
				size={38}
				iconSize={18}
				accessibilityLabel={t.t("habit.decrement")}
				disabled={value <= min}
				onPress={() => set(value - step)}
			/>
			<Text variant="h3" tabular style={styles.value} numberOfLines={1}>
				{format ? format(value) : t.number(value)}
			</Text>
			<IconButton
				icon={Plus}
				variant="soft"
				size={38}
				iconSize={18}
				accessibilityLabel={t.t("habit.increment")}
				disabled={value >= max}
				onPress={() => set(value + step)}
			/>
		</View>
	);
}

const useStyles = makeStyles(() => ({
	row: { flexDirection: "row", alignItems: "center", gap: 10 },
	value: { minWidth: 44, textAlign: "center" },
}));
