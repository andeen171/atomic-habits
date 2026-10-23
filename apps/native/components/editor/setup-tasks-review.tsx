import { AiSuggestButton } from "@/components/ai/ai-suggest-button";
import { ChevronRight, ListChecks, Plus, X } from "@/components/icons";
import { dateLabel } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type SetupTaskDraft,
	type TaskItem,
	anchorOf,
	pruneSetupDrafts,
	repeatLabel,
	setupFieldsFor,
} from "@atomic/core";
import { useAtomic, useHabitSetupTasks, useText, useToday } from "@atomic/core/react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import type { SetupDraftFields, SetupDraftUpdate } from "./setup-draft";
import {
	SetupMeta,
	defaultSetupRepeat,
	draftFieldText,
	lawName,
	newSetupDraft,
	openTask,
	setupTitle,
	useSetupRetitleOnSave,
} from "./setup-shared";

export interface SetupTasksReviewProps {
	draft: SetupDraftFields;
	update: SetupDraftUpdate;
	/** Edit mode: the habit (its existing setup tasks are listed too). */
	habitId?: string | null;
}

/**
 * The setup tasks the habit will create, on the review step and at the end
 * of the quick form (Annex T §5.4): each resolved draft (its title, law and
 * "Once · Today" or the repeat) with a remove button; in edit mode the tasks
 * already linked (they open in the task sheet); "Suggested" rows for filled
 * convertible fields that aren't tasks yet, each with "Add";
 * `AiSuggestButton habit.setupTasks`; and `setup.reviewEmpty` when there's
 * nothing. Renders its own heading.
 */
export function SetupTasksReview({ draft, update, habitId }: SetupTasksReviewProps) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const reduceMotion = useReduceMotion();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const setup = useHabitSetupTasks(habitId ?? undefined);
	useSetupRetitleOnSave(habitId);

	const kind = draft.kind;
	const fields = draftFieldText(draft);
	const drafts = pruneSetupDrafts(draft.setupTasks, kind);
	// Law order (1–4), then the order they were added in.
	const rows = drafts
		.map((d) => ({ draft: d, title: setupTitle(d.title ?? (d.field ? fields[d.field] : null)) }))
		.filter((row) => row.title)
		.sort((a, b) => a.draft.law - b.draft.law);
	const linked: TaskItem[] = habitId ? [...setup.active, ...setup.paused] : [];
	const suggestions = setupFieldsFor(kind).filter(
		(spec) =>
			setupTitle(fields[spec.field]) &&
			!drafts.some((d) => d.field === spec.field) &&
			!(habitId && setup.byField.get(spec.field)?.length),
	);
	const empty = !rows.length && !linked.length && !suggestions.length;

	const repeatText = (d: Pick<SetupTaskDraft, "repeat" | "date">) =>
		d.repeat
			? repeatLabel(d.repeat, t, { start: d.date, weekStartsOn })
			: `${t.t("repeat.once")} · ${dateLabel(d.date, today, t)}`;

	const remove = (key: string) => {
		haptics.selection();
		update({ setupTasks: draft.setupTasks.filter((d) => d.key !== key) });
	};

	const append = (row: SetupTaskDraft) => {
		haptics.light();
		update({ setupTasks: [...draft.setupTasks, row] });
	};

	const enter = reduceMotion ? undefined : FadeIn.duration(180);
	const exit = reduceMotion ? undefined : FadeOut.duration(120);
	const layout = reduceMotion ? undefined : LinearTransition.duration(180);

	return (
		<Card padding={0} testID="setup-review">
			<View style={styles.header}>
				<View style={styles.headerText}>
					<Text variant="h3" accessibilityRole="header">
						{t.t("setup.title")}
					</Text>
					<Text variant="small" tone="muted">
						{t.t(kind === "break" ? "setup.hintBreak" : "setup.hint")}
					</Text>
				</View>
				<AiSuggestButton
					kind="habit.setupTasks"
					label={t.t("setup.title")}
					disabled={!draft.name.trim()}
					input={() => ({ habit: draft.name.trim().slice(0, 80), kind })}
					onPick={(pick) =>
						append(
							newSetupDraft({
								field: null,
								law: pick.law,
								title: pick.title,
								repeat: defaultSetupRepeat(pick.title, today, weekStartsOn),
								date: today,
							}),
						)
					}
				/>
			</View>

			{rows.length || linked.length ? (
				<View style={styles.list}>
					{linked.map((item, index) => {
						const repeat = item.task.repeat
							? repeatLabel(item.task.repeat, t, {
									start: anchorOf(item.task),
									weekStartsOn,
									short: true,
								})
							: t.t("repeat.once");
						const label = t.t("setup.linked", { repeat });
						const title = text.task(item.task, "title");
						return (
							<Pressable
								key={item.key}
								onPress={() => openTask(item.task)}
								accessibilityRole="button"
								accessibilityLabel={`${title}, ${label}`}
								accessibilityHint={t.t("tasks.edit")}
								style={({ pressed }) => [
									styles.row,
									index > 0 && styles.separator,
									pressed && { backgroundColor: colors.hover },
								]}
								testID={`setup-review-linked-${item.task.id}`}
							>
								<View style={styles.lead}>
									<ListChecks size={17} color={colors.accentText} strokeWidth={2} />
								</View>
								<View style={styles.body}>
									<Text weight="medium">{title}</Text>
									<Text variant="small" tone="muted">
										{item.task.law ? `${lawName(item.task.law, kind, t)} · ` : ""}
										{label}
									</Text>
								</View>
								<ChevronRight size={18} color={colors.textSubtle} style={styles.trail} />
							</Pressable>
						);
					})}
					{rows.map(({ draft: row, title }, index) => (
						<Animated.View
							key={row.key}
							entering={enter}
							exiting={exit}
							layout={layout}
							style={[styles.row, (linked.length > 0 || index > 0) && styles.separator]}
							testID={`setup-review-row-${row.law}`}
						>
							<View style={styles.lead}>
								<View style={styles.circle} />
							</View>
							<View style={styles.body}>
								<Text weight="medium">{title}</Text>
								<SetupMeta
									law={row.law}
									kind={kind}
									repeating={!!row.repeat}
									when={repeatText(row)}
								/>
							</View>
							<IconButton
								icon={X}
								size={36}
								iconSize={18}
								color={colors.textMuted}
								accessibilityLabel={`${t.t("setup.remove")}: ${title}`}
								onPress={() => remove(row.key)}
								style={styles.removeBtn}
							/>
						</Animated.View>
					))}
				</View>
			) : null}

			{suggestions.length ? (
				<View
					style={[styles.suggested, (rows.length > 0 || linked.length > 0) && styles.separator]}
				>
					<Text variant="label" accessibilityRole="header" style={styles.suggestedLabel}>
						{t.t("setup.suggested")}
					</Text>
					{suggestions.map((spec) => {
						const title = setupTitle(fields[spec.field]);
						const repeat = defaultSetupRepeat(title, today, weekStartsOn);
						return (
							<Animated.View
								key={spec.field}
								entering={enter}
								exiting={exit}
								layout={layout}
								style={styles.suggestion}
							>
								<View style={styles.body}>
									<Text weight="medium">{title}</Text>
									<SetupMeta
										law={spec.law}
										kind={kind}
										repeating={!!repeat}
										when={repeatText({ repeat, date: today })}
									/>
								</View>
								<Button
									label={t.t("common.add")}
									icon={Plus}
									variant="secondary"
									size="sm"
									accessibilityLabel={`${t.t("common.add")}: ${title}`}
									onPress={() =>
										append(
											newSetupDraft({
												field: spec.field,
												law: spec.law,
												title: null,
												repeat,
												date: today,
											}),
										)
									}
									testID={`setup-suggest-add-${spec.field}`}
								/>
							</Animated.View>
						);
					})}
				</View>
			) : null}

			{empty ? (
				<Text variant="small" tone="muted" style={styles.empty}>
					{t.t("setup.reviewEmpty")}
				</Text>
			) : null}
		</Card>
	);
}

const useStyles = makeStyles((t) => ({
	header: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		paddingHorizontal: 16,
		paddingTop: 16,
		paddingBottom: 14,
	},
	headerText: { flex: 1, gap: 3 },
	list: { borderTopWidth: 1, borderTopColor: t.colors.border },
	row: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
		minHeight: 56,
		paddingLeft: 16,
		paddingRight: 8,
		paddingVertical: 12,
	},
	separator: { borderTopWidth: 1, borderTopColor: t.colors.border },
	lead: { width: 20, height: 22, alignItems: "center", justifyContent: "center" },
	circle: {
		width: 18,
		height: 18,
		borderRadius: 9,
		borderWidth: 1.5,
		borderColor: t.colors.borderStrong,
	},
	body: { flex: 1, minWidth: 0, gap: 1 },
	trail: { marginTop: 2, marginRight: 6 },
	removeBtn: { marginTop: -6 },
	suggested: { gap: 8, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 14 },
	suggestedLabel: { paddingHorizontal: 4 },
	suggestion: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		paddingVertical: 10,
		paddingLeft: 14,
		paddingRight: 10,
		borderRadius: t.radii.md,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		backgroundColor: t.colors.bg,
	},
	empty: { paddingHorizontal: 16, paddingBottom: 16, marginTop: -4 },
}));
