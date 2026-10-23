import type { LucideIcon } from "@/components/icons";
import { haptics } from "@/lib/haptics";
import { makeStyles, useTheme } from "@/lib/theme";
import { ScrollView, type StyleProp, View, type ViewStyle } from "react-native";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

export interface ToggleOption<T extends string | number> {
	value: T;
	label: string;
	icon?: LucideIcon;
	/** Spoken instead of the label (long names for short labels, e.g. weekdays). */
	accessibilityLabel?: string;
	disabled?: boolean;
}

interface ToggleGroupBase<T extends string | number> {
	options: readonly ToggleOption<T>[];
	/** Names the group for screen readers. */
	accessibilityLabel: string;
	size?: "sm" | "md";
	/** One horizontally scrolling row instead of wrapping lines. */
	scroll?: boolean;
	/** Stretch the options to share the row (no wrapping). */
	fill?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/** Exactly one option (radio semantics); `null` when nothing is picked yet. */
export interface SingleToggleGroupProps<T extends string | number> extends ToggleGroupBase<T> {
	type: "single";
	value: T | null;
	onChange: (value: T) => void;
}

/** Any number of options (checkbox semantics). */
export interface MultipleToggleGroupProps<T extends string | number> extends ToggleGroupBase<T> {
	type: "multiple";
	value: readonly T[];
	onChange: (value: T[]) => void;
}

export type ToggleGroupProps<T extends string | number> =
	| SingleToggleGroupProps<T>
	| MultipleToggleGroupProps<T>;

/**
 * A row of pill toggles: radio chips (`single`) or checkbox chips
 * (`multiple`). Selected chips use ink, never the accent; state is also in
 * the accessibility state, never conveyed by color alone. Hit targets stay
 * at 44pt or more.
 */
export function ToggleGroup<T extends string | number>(props: ToggleGroupProps<T>) {
	const { options, accessibilityLabel, size = "md", scroll, fill, style, testID } = props;
	const styles = useStyles();
	const isSelected = (value: T) =>
		props.type === "single" ? props.value === value : props.value.includes(value);
	const toggle = (value: T) => {
		haptics.selection();
		if (props.type === "single") {
			if (props.value !== value) props.onChange(value);
			return;
		}
		props.onChange(
			props.value.includes(value)
				? props.value.filter((v) => v !== value)
				: // Keep the options' order, not the tapping order.
					options
						.map((o) => o.value)
						.filter((v) => v === value || props.value.includes(v)),
		);
	};
	const chips = options.map((option) => (
		<ToggleChip
			key={String(option.value)}
			option={option}
			selected={isSelected(option.value)}
			role={props.type === "single" ? "radio" : "checkbox"}
			size={size}
			fill={fill}
			onPress={() => toggle(option.value)}
			testID={testID ? `${testID}-${option.value}` : undefined}
		/>
	));
	const groupProps = {
		accessibilityRole: props.type === "single" ? ("radiogroup" as const) : undefined,
		accessibilityLabel,
		testID,
	};
	if (scroll) {
		return (
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.scroll}
				style={style}
				{...groupProps}
			>
				{chips}
			</ScrollView>
		);
	}
	return (
		<View style={[styles.wrap, fill && styles.fillRow, style]} {...groupProps}>
			{chips}
		</View>
	);
}

function ToggleChip<T extends string | number>({
	option,
	selected,
	role,
	size,
	fill,
	onPress,
	testID,
}: {
	option: ToggleOption<T>;
	selected: boolean;
	role: "radio" | "checkbox";
	size: "sm" | "md";
	fill?: boolean;
	onPress: () => void;
	testID?: string;
}) {
	const { colors } = useTheme();
	const Icon = option.icon;
	const fg = selected ? colors.bg : colors.text;
	const height = size === "sm" ? 32 : 40;
	return (
		<PressableScale
			testID={testID}
			onPress={onPress}
			disabled={option.disabled}
			scaleTo={0.95}
			hitSlop={(44 - height) / 2}
			accessibilityRole={role}
			accessibilityLabel={option.accessibilityLabel ?? option.label}
			accessibilityState={
				role === "radio"
					? { selected, disabled: Boolean(option.disabled) }
					: { checked: selected, disabled: Boolean(option.disabled) }
			}
			style={[
				{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "center",
					gap: 6,
					height,
					paddingHorizontal: size === "sm" ? 12 : 14,
					borderRadius: 999,
					borderWidth: 1,
					backgroundColor: selected ? colors.text : colors.surface,
					borderColor: selected ? colors.text : colors.border,
					opacity: option.disabled ? 0.45 : 1,
				},
				fill && { flex: 1, paddingHorizontal: 6 },
			]}
		>
			{Icon ? <Icon size={size === "sm" ? 14 : 16} color={fg} strokeWidth={2} /> : null}
			<Text variant="small" weight="medium" color={fg} numberOfLines={1}>
				{option.label}
			</Text>
		</PressableScale>
	);
}

const useStyles = makeStyles(() => ({
	wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	fillRow: { flexWrap: "nowrap" },
	scroll: { flexDirection: "row", gap: 8, paddingRight: 20 },
}));
