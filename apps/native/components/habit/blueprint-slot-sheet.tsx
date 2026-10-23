import { AiSuggestButton } from "@/components/ai/ai-suggest-button";
import { offerSetupRetitle } from "@/components/editor/setup-shared";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { SmartTextField } from "@/components/ui/smart-text-field";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type BlueprintField,
	type BlueprintSlot,
	type Habit,
	type HabitPatch,
	SETUP_FIELDS,
	type SetupField,
	blueprintPatch,
	lawHeading,
} from "@atomic/core";
import { useActions, useAtomicStore, useIdentity, useText } from "@atomic/core/react";
import { useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	Platform,
	Pressable,
	type TextInput,
	type TextInputKeyPressEvent,
	View,
} from "react-native";

export interface BlueprintSlotSheetProps {
	habit: Habit;
	/** The slot being edited; the host keeps the last one while the sheet animates out. */
	slot: BlueprintSlot | undefined;
	open: boolean;
	onClose(): void;
	/** After the exit animation: the host returns focus to the slot's row. */
	onClosed?(): void;
}

/** Visible lines of a 280-character field before it scrolls. */
const LINE = 22;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const isSetupField = (field: BlueprintField): field is SetupField =>
	(SETUP_FIELDS as readonly string[]).includes(field);

/**
 * One blueprint slot in a sheet (Annex H §1.3, spec §6): the book concept as
 * the title, "law · stage" under it, the hint, then the input: an hour and
 * minute grid for the time, a field with the "After I…" prefix for the habit
 * stack, a growing field for the 280-character slots, or a plain field.
 * Save, Cancel and Clear sit in the footer above the keyboard; the return key
 * saves single-line fields (Ctrl/⌘+Enter the multi-line ones on the web
 * build), and Esc / back / a swipe down cancel.
 *
 * Saving trims (empty clears), plays a success haptic, announces "Blueprint
 * updated" and offers to retitle a linked setup task (spec §2.5). Clearing
 * comes with Undo.
 */
export function BlueprintSlotSheet({
	habit,
	slot,
	open,
	onClose,
	onClosed,
}: BlueprintSlotSheetProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const actions = useActions();
	const store = useAtomicStore();
	const original = slot?.value ?? "";
	const [draft, setDraft] = useState(original);
	const inputRef = useRef<TextInput>(null);

	// Each opening starts from the saved value; text fields focus once the sheet is up.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when a slot opens.
	useEffect(() => {
		if (!open || !slot) return;
		setDraft(slot.value ?? "");
		if (slot.input === "time") return;
		const timer = setTimeout(() => inputRef.current?.focus(), 340);
		return () => clearTimeout(timer);
	}, [open, slot?.field]);

	if (!slot) return <Sheet open={false} onClose={onClose} onClosed={onClosed} />;

	const heading = lawHeading(slot.law, habit.kind, t);
	const concept = t.t(slot.concept);
	const hint = t.t(slot.hint);
	const multiline = slot.input === "multiline";
	const trimmed = draft.trim();

	/** "Update the linked task too?" when a convertible field's text changed (spec §2.5; T2's offer). */
	const offerRetitle = () => {
		if (!isSetupField(slot.field)) return;
		const { data } = store.getState();
		const saved = data.habits[habit.id];
		if (saved) offerSetupRetitle(saved, slot.field, data.tasks, t, actions);
	};

	const toastCleared = (before: HabitPatch) => {
		showToast(`${t.t("blueprint.board.saved")} · ${concept}`, {
			action: {
				label: t.t("common.undo"),
				onPress: () => actions.updateHabit(habit.id, before),
			},
		});
	};

	const save = () => {
		if (trimmed === original.trim()) {
			onClose();
			return;
		}
		const value = trimmed || null;
		const before = previousValues(habit, slot.field);
		actions.setBlueprintField(habit.id, slot.field, value);
		onClose();
		if (value === null) {
			haptics.selection();
			toastCleared(before);
			return;
		}
		haptics.success();
		AccessibilityInfo.announceForAccessibility(t.t("blueprint.board.saved"));
		offerRetitle();
	};

	const clear = () => {
		const before = previousValues(habit, slot.field);
		actions.setBlueprintField(habit.id, slot.field, null);
		haptics.selection();
		onClose();
		toastCleared(before);
	};

	/**
	 * Web build keys: Esc cancels (the text input keeps key events from
	 * reaching the sheet) and Ctrl/⌘+Enter saves a multi-line field. Phones
	 * use the Save button, the return key and back / swipe down.
	 */
	const onKeyPress = (event: TextInputKeyPressEvent) => {
		if (Platform.OS !== "web") return;
		const key = event.nativeEvent as unknown as {
			key: string;
			ctrlKey?: boolean;
			metaKey?: boolean;
		};
		const prevent = () => (event as unknown as { preventDefault?: () => void }).preventDefault?.();
		if (key.key === "Escape") {
			prevent();
			onClose();
			return;
		}
		if (multiline && key.key === "Enter" && (key.ctrlKey || key.metaKey)) {
			prevent();
			save();
		}
	};

	const counter =
		slot.input !== "time" && draft.length > slot.maxLength * 0.8 ? (
			<Text
				variant="tiny"
				tone={draft.length >= slot.maxLength ? "danger" : "muted"}
				align="right"
				tabular
				style={styles.counter}
				accessibilityLiveRegion="polite"
			>
				{`${t.number(draft.length)} / ${t.number(slot.maxLength)}`}
			</Text>
		) : null;

	const control =
		slot.input === "time" ? (
			<TimeGrid value={draft} onChange={setDraft} placeholder={t.t(slot.placeholder)} />
		) : (
			<SmartTextField
				ref={inputRef}
				field={`habit.${slot.field}` as "habit.cueLocation"}
				value={draft}
				onChangeText={setDraft}
				maxLength={slot.maxLength}
				placeholder={t.t(slot.placeholder)}
				prefix={slot.field === "stackAfter" ? t.t("form.stackAfterPrefix") : undefined}
				accessibilityLabel={concept}
				accessibilityHint={hint}
				multiline={multiline}
				scrollEnabled={multiline}
				textAlignVertical={multiline ? "top" : undefined}
				returnKeyType={multiline ? "default" : "done"}
				onSubmitEditing={multiline ? undefined : save}
				onKeyPress={onKeyPress}
				style={multiline ? styles.multiline : undefined}
				testID="blueprint-slot-input"
			/>
		);

	return (
		<Sheet
			open={open}
			onClose={onClose}
			onClosed={onClosed}
			title={concept}
			subtitle={t.t("blueprint.board.lawHeading", heading)}
			scroll
			testID="blueprint-slot-sheet"
			footer={
				<View style={styles.footer}>
					{original ? (
						<Pressable
							onPress={clear}
							hitSlop={6}
							accessibilityRole="button"
							style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
							testID="blueprint-slot-clear"
						>
							<Text weight="semibold" color={colors.danger}>
								{t.t("blueprint.board.clear")}
							</Text>
						</Pressable>
					) : null}
					<View style={styles.footerEnd}>
						<Button
							label={t.t("common.cancel")}
							variant="ghost"
							onPress={onClose}
							testID="blueprint-slot-cancel"
						/>
						<Button label={t.t("common.save")} onPress={save} testID="blueprint-slot-save" />
					</View>
				</View>
			}
		>
			<View style={styles.top}>
				<Text variant="small" tone="muted" style={styles.hint}>
					{hint}
				</Text>
				<SlotSuggest habit={habit} field={slot.field} label={concept} onPick={setDraft} />
			</View>
			{control}
			{counter}
		</Sheet>
	);
}

/** Hour and minute cells in place (no second sheet on top of this one). */
function TimeGrid({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	const t = useT();
	const styles = useStyles();
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	const hour = match ? Number(match[1]) : null;
	const minute = match ? Number(match[2]) : null;
	const set = (h: number, m: number) => {
		haptics.selection();
		onChange(`${pad(h)}:${pad(m)}`);
	};
	return (
		<View>
			<Text
				variant="display"
				tabular
				tone={match ? "default" : "muted"}
				style={styles.readout}
				accessibilityLiveRegion="polite"
				testID="blueprint-slot-time"
			>
				{match ? value : placeholder}
			</Text>
			<Text variant="label" style={styles.gridLabel}>
				{t.x("editor.hour")}
			</Text>
			<View
				style={styles.grid}
				accessibilityRole="radiogroup"
				accessibilityLabel={t.x("editor.hour")}
			>
				{HOURS.map((h) => (
					<TimeCell
						key={h}
						label={pad(h)}
						selected={h === hour}
						onPress={() => set(h, minute ?? 0)}
					/>
				))}
			</View>
			<Text variant="label" style={[styles.gridLabel, styles.gridLabelGap]}>
				{t.x("editor.minute")}
			</Text>
			<View
				style={styles.grid}
				accessibilityRole="radiogroup"
				accessibilityLabel={t.x("editor.minute")}
			>
				{MINUTES.map((m) => (
					<TimeCell
						key={m}
						label={`:${pad(m)}`}
						selected={m === minute}
						onPress={() => set(hour ?? 7, m)}
					/>
				))}
			</View>
		</View>
	);
}

function TimeCell({
	label,
	selected,
	onPress,
}: { label: string; selected: boolean; onPress: () => void }) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="radio"
			accessibilityState={{ selected }}
			accessibilityLabel={label}
			style={({ pressed }) => [
				styles.cell,
				selected && { backgroundColor: colors.text },
				pressed && !selected && { backgroundColor: colors.hover },
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

/** The habit's values for the fields a slot edit touches, for Undo. */
function previousValues(habit: Habit, field: BlueprintField): HabitPatch {
	const touched = Object.keys(blueprintPatch(habit, field, null)) as (keyof HabitPatch)[];
	const before: Record<string, unknown> = {};
	for (const key of touched) before[key] = habit[key as keyof Habit] ?? null;
	return before as HabitPatch;
}

/**
 * The slot's AI suggestion (spec §5.3 table; T5's `AiSuggestButton`, nothing
 * without an account or the feature). A pick fills the field; Save keeps it.
 */
function SlotSuggest({
	habit,
	field,
	label,
	onPick,
}: {
	habit: Habit;
	field: BlueprintField;
	label: string;
	onPick(value: string): void;
}) {
	const text = useText();
	const identity = useIdentity(habit.identityId);
	const name = text.habit(habit, "name");
	const kind = habit.kind;
	if (kind === "build" && (field === "cueTime" || field === "cueLocation")) {
		return (
			<AiSuggestButton
				kind="habit.intention"
				label={label}
				input={() => ({
					habit: name,
					kind,
					timeOfDay: habit.timeOfDay === "anytime" ? undefined : habit.timeOfDay,
				})}
				onPick={(pick) => {
					const value = field === "cueTime" ? pick.time : pick.location;
					if (value) onPick(value);
				}}
			/>
		);
	}
	if (kind === "build" && field === "stackAfter") {
		return (
			<AiSuggestButton
				kind="habit.stack"
				label={label}
				input={() => ({ habit: name })}
				onPick={onPick}
			/>
		);
	}
	if (kind === "build" && field === "twoMinute") {
		return (
			<AiSuggestButton
				kind="habit.twoMinute"
				label={label}
				input={() => ({ habit: name, kind })}
				onPick={onPick}
			/>
		);
	}
	const law =
		field === "environment"
			? "obvious"
			: field === "bundle"
				? "attractive"
				: field === "twoMinute"
					? "easy"
					: field === "reward"
						? "satisfying"
						: null;
	if (!law) return null;
	return (
		<AiSuggestButton
			kind="habit.laws"
			label={label}
			input={() => ({
				habit: name,
				kind,
				identity: identity ? text.identity(identity, "statement") : undefined,
			})}
			onPick={(pick) => onPick(pick[law])}
		/>
	);
}

const useStyles = makeStyles((t) => ({
	top: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
	hint: { flex: 1, paddingTop: 2 },
	multiline: { minHeight: 3 * LINE + 24, maxHeight: 8 * LINE + 24, lineHeight: LINE },
	counter: { marginTop: 6 },
	readout: { marginBottom: 12 },
	gridLabel: { marginBottom: 8 },
	gridLabelGap: { marginTop: 16 },
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
	cell: {
		width: "15%",
		flexGrow: 1,
		height: 44,
		borderRadius: 10,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	footer: { flexDirection: "row", alignItems: "center", gap: 8 },
	footerEnd: { flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: 8 },
	clear: {
		minHeight: 46,
		paddingHorizontal: 12,
		marginLeft: -12,
		borderRadius: 999,
		justifyContent: "center",
	},
	clearPressed: { backgroundColor: t.colors.dangerSoft },
}));
