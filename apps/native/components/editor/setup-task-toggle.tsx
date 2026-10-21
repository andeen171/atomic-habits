import { ListChecks } from "@/components/icons";
import { RepeatChip } from "@/components/tasks/repeat-field";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { type RepeatRule, type SetupField, setupFieldsFor } from "@atomic/core";
import { useAtomic, useHabitSetupTasks, useToday } from "@atomic/core/react";
import { useEffect, useRef } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import type { SetupDraftFields, SetupDraftUpdate } from "./setup-draft";
import {
	LinkedTaskChip,
	defaultSetupRepeat,
	linkedSetupTask,
	newSetupDraft,
	sameRule,
	useSameDaysPreset,
	useSetupRetitleOnSave,
} from "./setup-shared";

export interface SetupTaskToggleProps {
	/** The convertible field it sits under (`environment`, `twoMinute`, `reward`). */
	field: SetupField;
	draft: SetupDraftFields;
	update: SetupDraftUpdate;
	/** Edit mode: the habit, whose linked task shows as a chip instead. */
	habitId?: string | null;
}

/**
 * "Also create a task" under a convertible field (Annex T §1.5, §5.4): a
 * switch row shown once the field has text; when on, a compact repeat chip
 * defaulting to `suggestRepeatFromText` ("every morning" → Every day), with
 * "Same days as the habit" in its sheet. It writes `draft.setupTasks` (title
 * null: the task follows the field's text at save time). In edit mode a
 * field that already has a linked task (going, or else done) shows the
 * `setup.linked` chip ("Task: Every day ›"), which opens that task, instead.
 */
export function SetupTaskToggle({ field, draft, update, habitId }: SetupTaskToggleProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const reduceMotion = useReduceMotion();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const setup = useHabitSetupTasks(habitId ?? undefined);
	useSetupRetitleOnSave(habitId);

	const spec = setupFieldsFor(draft.kind).find((s) => s.field === field);
	const text = draft[field].trim();
	const linked = habitId ? linkedSetupTask(setup, field) : null;
	const own = draft.setupTasks.find((d) => d.field === field);
	const sameDays = useSameDaysPreset(draft, own?.date ?? today);

	// While the repeat is still the default for the text, it follows the text
	// ("…every morning" turns it into Every day). A rule the user picked stays.
	const previous = useRef(text);
	useEffect(() => {
		const before = previous.current;
		previous.current = text;
		if (!own || before === text) return;
		if (!sameRule(own.repeat, defaultSetupRepeat(before, own.date, weekStartsOn))) return;
		const next = defaultSetupRepeat(text, own.date, weekStartsOn);
		if (sameRule(next, own.repeat)) return;
		update({
			setupTasks: draft.setupTasks.map((d) => (d.key === own.key ? { ...d, repeat: next } : d)),
		});
	}, [text, own, draft.setupTasks, update, weekStartsOn]);

	if (!spec) return null;

	if (linked) {
		return (
			<Animated.View
				entering={reduceMotion ? undefined : FadeIn.duration(180)}
				style={styles.attached}
			>
				<LinkedTaskChip task={linked.task} done={linked.done} />
			</Animated.View>
		);
	}

	if (!text) return null;

	const on = Boolean(own);
	const toggle = (next: boolean) => {
		const others = draft.setupTasks.filter((d) => d.field !== field);
		update({
			setupTasks: next
				? [
						...others,
						newSetupDraft({
							field,
							law: spec.law,
							title: null,
							repeat: defaultSetupRepeat(text, today, weekStartsOn),
							date: today,
						}),
					]
				: others,
		});
	};

	const setRepeat = (repeat: RepeatRule | null) => {
		if (!own) return;
		update({
			setupTasks: draft.setupTasks.map((d) => (d.key === own.key ? { ...d, repeat } : d)),
		});
	};

	return (
		<Animated.View
			entering={reduceMotion ? undefined : FadeIn.duration(180)}
			exiting={reduceMotion ? undefined : FadeOut.duration(120)}
			style={[styles.attached, styles.box, on && styles.boxOn]}
			testID={`setup-toggle-${field}`}
		>
			<View style={styles.row}>
				{/* The label toggles too (a bigger target); screen readers get the switch alone. */}
				<Pressable
					onPress={() => {
						haptics.selection();
						toggle(!on);
					}}
					accessible={false}
					importantForAccessibility="no"
					style={styles.label}
				>
					<ListChecks size={16} color={on ? colors.accentText : colors.textMuted} strokeWidth={2} />
					<Text variant="small" weight="medium" style={styles.labelText}>
						{t.t("setup.toggle")}
					</Text>
				</Pressable>
				<Switch
					value={on}
					onValueChange={toggle}
					accessibilityLabel={t.t("setup.toggle")}
					testID={`setup-toggle-switch-${field}`}
				/>
			</View>
			{own ? (
				<Animated.View
					entering={reduceMotion ? undefined : FadeIn.duration(160)}
					style={styles.repeat}
				>
					<RepeatChip
						value={own.repeat}
						onChange={setRepeat}
						start={own.date}
						weekStartsOn={weekStartsOn}
						extra={sameDays}
						noneLabel={t.t("repeat.once")}
						size="sm"
					/>
				</Animated.View>
			) : null}
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	// Sits right under its field: the editor's sections space fields 20pt apart.
	attached: { marginTop: -12 },
	box: {
		borderRadius: t.radii.md,
		paddingLeft: 12,
		paddingRight: 8,
		paddingVertical: 6,
		borderWidth: 1,
		borderColor: t.colors.border,
		borderStyle: "dashed",
	},
	boxOn: { borderStyle: "solid", backgroundColor: t.colors.surface },
	row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
	label: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
	labelText: { flexShrink: 1 },
	repeat: { paddingBottom: 6, paddingLeft: 24 },
}));
