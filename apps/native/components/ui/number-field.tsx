import { Minus, Plus } from "@/components/icons";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import { forwardRef, useEffect, useRef, useState } from "react";
import { type StyleProp, type TextInput, View, type ViewStyle } from "react-native";
import { IconButton } from "./icon-button";
import { Text } from "./text";
import { TextField } from "./text-field";

export interface NumberFieldProps {
	value: number | null;
	/** Called with every valid edit (and `null` when cleared); clamped on blur. */
	onChange: (value: number | null) => void;
	/** Visible label; also the accessible name unless `accessibilityLabel` is set. */
	label?: string;
	accessibilityLabel?: string;
	hint?: string;
	error?: string | null;
	placeholder?: string;
	min?: number;
	max?: number;
	/** Fraction digits allowed (0: whole numbers, the number pad). */
	decimals?: number;
	/** −/+ buttons that move by `step`. */
	step?: number;
	/** Text before the number ("R$"). */
	prefix?: string;
	/** Text after the number ("pages"). */
	unit?: string;
	size?: "md" | "lg";
	autoFocus?: boolean;
	onSubmitEditing?: () => void;
	containerStyle?: StyleProp<ViewStyle>;
	testID?: string;
}

/** The locale's decimal separator ("," in pt-BR). */
function decimalSeparator(locale: string): string {
	try {
		return (1.5).toLocaleString(locale).charAt(1) || ".";
	} catch {
		return ".";
	}
}

function format(value: number | null, decimals: number, separator: string): string {
	if (value === null || !Number.isFinite(value)) return "";
	const fixed = decimals > 0 ? String(Number(value.toFixed(decimals))) : String(Math.round(value));
	return fixed.replace(".", separator);
}

/** Parses "12", "12,5", "12.5", "-3"; undefined when the text is not a number (yet). */
function parse(text: string, decimals: number): number | null | undefined {
	const clean = text.replace(/\s/g, "").replace(",", ".");
	if (clean === "") return null;
	const pattern = decimals > 0 ? /^-?\d*\.?\d*$/ : /^-?\d*$/;
	if (!pattern.test(clean) || clean === "-" || clean === "." || clean === "-.") return undefined;
	const value = Number(clean);
	if (!Number.isFinite(value)) return undefined;
	return decimals > 0 ? Number(value.toFixed(decimals)) : Math.trunc(value);
}

/**
 * Numeric text field with locale-aware decimals, an optional unit and
 * optional −/+ buttons (amounts, pages, minutes). Out-of-range values are
 * clamped when the field loses focus.
 */
export const NumberField = forwardRef<TextInput, NumberFieldProps>(function NumberField(
	{
		value,
		onChange,
		label,
		accessibilityLabel,
		hint,
		error,
		placeholder,
		min = Number.NEGATIVE_INFINITY,
		max = Number.POSITIVE_INFINITY,
		decimals = 0,
		step,
		prefix,
		unit,
		size = "md",
		autoFocus,
		onSubmitEditing,
		containerStyle,
		testID,
	},
	ref,
) {
	const t = useT();
	const styles = useStyles();
	const separator = decimalSeparator(t.locale);
	const [text, setText] = useState(() => format(value, decimals, separator));
	const lastEmitted = useRef<number | null>(value);

	// Follow outside changes (steppers, resets) without fighting the user's typing.
	useEffect(() => {
		if (value !== lastEmitted.current) {
			lastEmitted.current = value;
			setText(format(value, decimals, separator));
		}
	}, [value, decimals, separator]);

	const emit = (next: number | null) => {
		lastEmitted.current = next;
		onChange(next);
	};
	const clamp = (n: number) => Math.max(min, Math.min(max, n));

	const onChangeText = (next: string) => {
		setText(next);
		const parsed = parse(next, decimals);
		if (parsed === undefined) return;
		if (parsed === null || (parsed >= min && parsed <= max)) emit(parsed);
	};

	const onBlur = () => {
		const parsed = parse(text, decimals);
		if (parsed === undefined || parsed === null) {
			setText(format(value, decimals, separator));
			return;
		}
		const clamped = clamp(parsed);
		setText(format(clamped, decimals, separator));
		if (clamped !== value) emit(clamped);
	};

	const bump = (direction: 1 | -1) => {
		if (!step) return;
		const base = value ?? (Number.isFinite(min) ? min : 0);
		const next = clamp(Number((base + direction * step).toFixed(Math.max(decimals, 0))));
		if (next === value) return;
		haptics.selection();
		setText(format(next, decimals, separator));
		emit(next);
	};

	const name = accessibilityLabel ?? label;
	const field = (
		<TextField
			ref={ref}
			label={label}
			hint={hint}
			error={error}
			value={text}
			onChangeText={onChangeText}
			onBlur={onBlur}
			placeholder={placeholder}
			prefix={prefix}
			keyboardType={decimals > 0 ? "decimal-pad" : "number-pad"}
			inputMode={decimals > 0 ? "decimal" : "numeric"}
			returnKeyType="done"
			onSubmitEditing={onSubmitEditing}
			autoFocus={autoFocus}
			size={size}
			accessibilityLabel={unit && name ? `${name} (${unit})` : name}
			right={
				unit ? (
					<Text tone="muted" style={styles.unit} numberOfLines={1}>
						{unit}
					</Text>
				) : undefined
			}
			containerStyle={step ? styles.grow : containerStyle}
			testID={testID}
		/>
	);
	if (!step) return field;
	return (
		<View style={[styles.row, containerStyle]}>
			<IconButton
				icon={Minus}
				variant="soft"
				size={40}
				iconSize={18}
				accessibilityLabel={t.t("habit.decrement")}
				disabled={value !== null && value <= min}
				onPress={() => bump(-1)}
			/>
			{field}
			<IconButton
				icon={Plus}
				variant="soft"
				size={40}
				iconSize={18}
				accessibilityLabel={t.t("habit.increment")}
				disabled={value !== null && value >= max}
				onPress={() => bump(1)}
			/>
		</View>
	);
});

const useStyles = makeStyles(() => ({
	row: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
	grow: { flex: 1 },
	unit: { marginLeft: 8, maxWidth: 120 },
}));
