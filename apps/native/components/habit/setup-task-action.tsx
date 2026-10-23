import {
	LinkedTaskChip,
	linkedSetupLabel,
	linkedSetupTask,
	openTask,
	releaseSetupRetitle,
} from "@/components/editor/setup-shared";
import { CircleCheck, ListChecks, ListPlus } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast, ui } from "@/lib/ui-store";
import { type Habit, type SetupField, setupTaskPrefill } from "@atomic/core";
import { useAtomic, useHabitSetupTasks, useText, useToday } from "@atomic/core/react";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

export interface SetupTaskActionProps {
	habit: Habit;
	/** A filled convertible blueprint slot. */
	field: SetupField;
	/** Icon-only, for the blueprint slot row. */
	compact?: boolean;
}

/**
 * "Make it a task" for a filled convertible field, or the linked task once
 * one exists (Annex T §5.4; a done one shows a check). T1's `BlueprintBoard`
 * renders it beside each filled convertible slot (`compact`: a 36pt icon
 * button; a long press names it, like a tooltip). "Make it a task" opens the
 * composer prefilled from the field (`setupTaskPrefill`: its text, the
 * text's repeat, the habit link); the linked one opens that task. Nothing
 * renders for an empty or non-convertible field, or "Make it a task" on an
 * archived habit.
 */
export function SetupTaskAction({ habit, field, compact }: SetupTaskActionProps) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const setup = useHabitSetupTasks(habit.id);
	// On the habit's page the blueprint slot sheet offers retitles itself (see setup-shared).
	useFocusEffect(useCallback(() => releaseSetupRetitle(habit.id), [habit.id]));

	const linked = linkedSetupTask(setup, field);
	if (linked) {
		if (!compact) return <LinkedTaskChip task={linked.task} done={linked.done} />;
		const label = `${linkedSetupLabel(linked.task, t, weekStartsOn)} · ${text.task(linked.task, "title")}`;
		return (
			<PressableScale
				onPress={() => openTask(linked.task)}
				onLongPress={() => {
					haptics.selection();
					showToast(label);
				}}
				scaleTo={0.9}
				hitSlop={4}
				accessibilityRole="button"
				accessibilityLabel={linked.done ? `${label} (${t.t("tasks.series.doneState")})` : label}
				accessibilityHint={t.t("tasks.edit")}
				style={[
					styles.icon,
					{ backgroundColor: linked.done ? colors.successSoft : colors.accentSoft },
				]}
				testID={`setup-action-${field}`}
			>
				{linked.done ? (
					<CircleCheck size={17} color={colors.success} strokeWidth={2.2} />
				) : (
					<ListChecks size={17} color={colors.accentText} strokeWidth={2.2} />
				)}
			</PressableScale>
		);
	}

	if (habit.archivedAt) return null;
	const prefill = setupTaskPrefill(habit, field, today, weekStartsOn === 0 ? 0 : 1);
	if (!prefill) return null;
	const make = () => {
		haptics.selection();
		ui.openComposer(prefill.date ?? today, prefill);
	};

	if (compact) {
		return (
			<PressableScale
				onPress={make}
				onLongPress={() => {
					haptics.selection();
					showToast(t.t("setup.makeTask"));
				}}
				scaleTo={0.9}
				hitSlop={4}
				accessibilityRole="button"
				accessibilityLabel={`${t.t("setup.makeTask")}: ${prefill.title}`}
				style={[styles.icon, styles.iconEmpty]}
				testID={`setup-action-${field}`}
			>
				<ListPlus size={17} color={colors.textMuted} strokeWidth={2.1} />
			</PressableScale>
		);
	}
	return (
		<PressableScale
			onPress={make}
			scaleTo={0.96}
			hitSlop={6}
			accessibilityRole="button"
			accessibilityLabel={`${t.t("setup.makeTask")}: ${prefill.title}`}
			style={styles.chip}
			testID={`setup-action-${field}`}
		>
			<ListPlus size={15} color={colors.textMuted} strokeWidth={2.1} />
			<Text variant="small" weight="medium" tone="muted" style={styles.chipText}>
				{t.t("setup.makeTask")}
			</Text>
		</PressableScale>
	);
}

const useStyles = makeStyles((t) => ({
	icon: {
		width: 40,
		height: 40,
		borderRadius: 20,
		alignItems: "center",
		justifyContent: "center",
	},
	iconEmpty: {
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
	},
	chip: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		maxWidth: "100%",
		gap: 6,
		minHeight: 34,
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 17,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
	},
	chipText: { flexShrink: 1 },
}));
