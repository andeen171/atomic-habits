import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles } from "@/lib/theme";
import type { Completion, CompletionField } from "@atomic/core";
import { useAtomic, useCompletions } from "@atomic/core/react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AccessibilityInfo, Platform, ScrollView, type TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";
import { TextField, type TextFieldProps } from "./text-field";

export type { CompletionField } from "@atomic/core";

export interface SmartTextFieldProps extends TextFieldProps {
	/** Which corpus completes this field. */
	field: CompletionField;
}

/** The chip row: 36pt chips with a 44pt touch target, plus the gap above them. */
const CHIP = 36;
const ROW = 44;
const GAP = 6;
/** Hiding waits this long: a chip tap on the web blurs the input first, and quick typing doesn't flicker the row. */
const LINGER_MS = 220;
/** Screen readers hear the best suggestion once the typing pauses. */
const ANNOUNCE_MS = 600;

const NONE: readonly Completion[] = [];

type FocusHandler = NonNullable<TextFieldProps["onFocus"]>;

/**
 * `TextField` with on-device completion (Annex C §1.7 and §5, D33): while
 * the field is focused, up to three "Use “…”" chips in a row right under it
 * (no ghost text: React Native can't overlay it reliably). A tap fills the
 * field (the typed part stays, the completed part is what the chip shows in
 * bold) and hides the row until the next keystroke; the keyboard stays up.
 * The row opens and closes with a short height animation (none under reduce
 * motion) and lingers between keystrokes, so typing doesn't make the screen
 * jump. Screen readers hear the best suggestion after 600 ms without typing,
 * once per suggestion. With "Suggestions while typing" off it is exactly
 * `TextField`. Never used for the journal (D19). Owner: T5.
 */
export const SmartTextField = forwardRef<TextInput, SmartTextFieldProps>(function SmartTextField(
	{ field, ...props },
	ref,
) {
	const typing = useAtomic((s) => s.settings.typingSuggestions);
	if (!typing) return <TextField ref={ref} {...props} />;
	return <SmartField ref={ref} field={field} {...props} />;
});

const SmartField = forwardRef<TextInput, SmartTextFieldProps>(function SmartField(
	{
		field,
		value: hostValue,
		defaultValue,
		onChangeText,
		onFocus,
		onBlur,
		hint,
		error,
		containerStyle,
		...rest
	},
	ref,
) {
	const t = useT();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const inputRef = useRef<TextInput | null>(null);
	useImperativeHandle(ref, () => inputRef.current as TextInput, []);

	const controlled = hostValue !== undefined;
	const [ownValue, setOwnValue] = useState(defaultValue ?? "");
	const value = controlled ? (hostValue ?? "") : ownValue;

	const [focused, setFocused] = useState(false);
	/** Hidden until the next keystroke (just accepted). */
	const [dismissed, setDismissed] = useState(false);
	const completions = useCompletions(field, value, { enabled: focused });
	const shown = focused && !dismissed ? completions : NONE;

	// The row stays open a moment after the chips go away (a blur from a chip
	// tap on the web, a keystroke with no match), keeping what it last showed.
	const [open, setOpen] = useState(false);
	const [chips, setChips] = useState<readonly Completion[]>(NONE);
	const [typed, setTyped] = useState("");
	useEffect(() => {
		if (shown.length > 0) {
			setChips(shown);
			setTyped(value);
			setOpen(true);
			return;
		}
		const timer = setTimeout(() => setOpen(false), focused && !dismissed ? LINGER_MS : 0);
		return () => clearTimeout(timer);
	}, [shown, value, focused, dismissed]);

	const height = useSharedValue(0);
	useEffect(() => {
		const target = open ? ROW + GAP : 0;
		height.value = reduceMotion ? target : withTiming(target, { duration: open ? 160 : 140 });
	}, [open, reduceMotion, height]);
	const rowStyle = useAnimatedStyle(() => ({ height: height.value }));

	// One announcement per suggestion, after a pause in typing.
	const announced = useRef(new Set<string>());
	const best = shown[0]?.text ?? null;
	useEffect(() => {
		if (!best || announced.current.has(best)) return;
		const timer = setTimeout(() => {
			announced.current.add(best);
			AccessibilityInfo.announceForAccessibility(t.t("complete.availableBelow", { text: best }));
		}, ANNOUNCE_MS);
		return () => clearTimeout(timer);
	}, [best, t]);

	/** A chip is being pressed: its blur (web) must not hide the row. */
	const pressing = useRef(false);
	const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (blurTimer.current) clearTimeout(blurTimer.current);
		},
		[],
	);

	const change = useCallback(
		(next: string) => {
			if (!controlled) setOwnValue(next);
			setDismissed(false);
			onChangeText?.(next);
		},
		[controlled, onChangeText],
	);

	const accept = (completion: Completion) => {
		pressing.current = false;
		haptics.selection();
		if (!controlled) setOwnValue(completion.text);
		onChangeText?.(completion.text);
		setDismissed(true);
		// Keep typing where you were (the web moved focus to the chip).
		if (Platform.OS === "web") inputRef.current?.focus();
	};

	const handleFocus: FocusHandler = (event) => {
		if (blurTimer.current) clearTimeout(blurTimer.current);
		blurTimer.current = null;
		setFocused(true);
		onFocus?.(event);
	};

	const handleBlur: FocusHandler = (event) => {
		onBlur?.(event);
		if (pressing.current) return;
		if (blurTimer.current) clearTimeout(blurTimer.current);
		blurTimer.current = setTimeout(() => {
			blurTimer.current = null;
			setFocused(false);
			setDismissed(false);
			announced.current.clear();
		}, LINGER_MS);
	};

	return (
		<View style={containerStyle}>
			<TextField
				ref={inputRef}
				{...rest}
				value={value}
				onChangeText={change}
				onFocus={handleFocus}
				onBlur={handleBlur}
				autoComplete={rest.autoComplete ?? "off"}
			/>
			<Animated.View
				style={[styles.rowClip, rowStyle]}
				pointerEvents={open ? "box-none" : "none"}
				accessibilityElementsHidden={!open}
				importantForAccessibility={open ? "auto" : "no-hide-descendants"}
			>
				{chips.length ? (
					<ScrollView
						horizontal
						keyboardShouldPersistTaps="always"
						showsHorizontalScrollIndicator={false}
						style={styles.row}
						contentContainerStyle={styles.rowContent}
						accessibilityLabel={t.t("complete.listLabel")}
						testID={rest.testID ? `${rest.testID}-completions` : undefined}
					>
						{chips.map((completion) => (
							<CompletionChip
								key={completion.text}
								completion={completion}
								typed={typed}
								label={t.t("complete.use", { text: completion.text })}
								onPressIn={() => {
									pressing.current = true;
								}}
								onPressOut={() => {
									// A drag that turned into a scroll: the field may have lost focus meanwhile.
									setTimeout(() => {
										pressing.current = false;
									}, 0);
								}}
								onPress={() => accept(completion)}
							/>
						))}
					</ScrollView>
				) : null}
			</Animated.View>
			{error ? (
				<Text variant="small" tone="danger" style={styles.hint} accessibilityLiveRegion="polite">
					{error}
				</Text>
			) : hint ? (
				<Text variant="small" tone="subtle" style={styles.hint}>
					{hint}
				</Text>
			) : null}
		</View>
	);
});

function CompletionChip({
	completion,
	typed,
	label,
	onPress,
	onPressIn,
	onPressOut,
}: {
	completion: Completion;
	typed: string;
	label: string;
	onPress(): void;
	onPressIn(): void;
	onPressOut(): void;
}) {
	const styles = useStyles();
	// The typed part stays as typed; what the chip adds is in bold.
	const append = completion.mode === "append" && completion.text.startsWith(typed);
	return (
		<PressableScale
			onPress={onPress}
			onPressIn={onPressIn}
			onPressOut={onPressOut}
			scaleTo={0.95}
			hitSlop={{ top: (ROW - CHIP) / 2, bottom: (ROW - CHIP) / 2, left: 3, right: 3 }}
			accessibilityRole="button"
			accessibilityLabel={label}
			style={styles.chip}
		>
			<Text variant="small" numberOfLines={1} style={styles.chipText}>
				{append ? (
					<>
						<Text variant="small" tone="muted">
							{typed}
						</Text>
						<Text variant="small" weight="semibold">
							{completion.suffix}
						</Text>
					</>
				) : (
					<Text variant="small" weight="medium">
						{completion.text}
					</Text>
				)}
			</Text>
		</PressableScale>
	);
}

const useStyles = makeStyles((t) => ({
	rowClip: { overflow: "hidden" },
	row: { marginTop: GAP, height: ROW, flexGrow: 0 },
	rowContent: { alignItems: "center", gap: 8, paddingRight: 4 },
	chip: {
		height: CHIP,
		maxWidth: 300,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 13,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	chipText: { flexShrink: 1 },
	hint: { marginTop: 6 },
}));
