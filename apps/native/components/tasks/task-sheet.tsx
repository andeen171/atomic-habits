import { AiSuggestButton } from "@/components/ai/ai-suggest-button";
import {
	Archive,
	Check,
	CircleCheck,
	Info,
	type LucideIcon,
	Repeat,
	RotateCcw,
	SkipForward,
	Trash2,
	X,
} from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { SmartTextField } from "@/components/ui/smart-text-field";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { TimeField } from "@/components/ui/time-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type RepeatRule,
	type SeriesState,
	type Task,
	type TaskLog,
	canSettleOccurrence,
	diffDays,
	isKnownRule,
} from "@atomic/core";
import { useActions, useAtomic, useHabit, useSeries, useText, useToday } from "@atomic/core/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { HabitLinkField } from "./habit-link-field";
import { RepeatRow } from "./repeat-field";
import { SeriesHistory } from "./series-history";
import { DateChips, PriorityPicker } from "./task-fields";
import { useOccurrenceActions } from "./use-occurrence-actions";

type OccurrenceView = "open" | "done" | "skipped" | "missed" | "projected";

export interface TaskSheetProps {
	id: string;
	/** The occurrence a series row was opened for (else its open one). */
	occurrence?: DayKey | null;
	/** Called once the sheet finished closing (pop the route). */
	onClosed(): void;
}

/**
 * The task editor as a bottom sheet (Annex T §5.3). Edits save as they
 * happen (title and notes on blur or close). A series also shows the
 * occurrence it was opened for at the top, with Skip this time / Done (or
 * Mark as not done) in the footer, its history, and Stop repeating or
 * Resume; a one-off keeps Delete / Done.
 */
export function TaskSheet({ id, occurrence = null, onClosed }: TaskSheetProps) {
	const t = useT();
	const styles = useStyles();
	const actions = useActions();
	const occurrenceActions = useOccurrenceActions();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const task = useAtomic((s) => s.data.tasks[id]);
	const current = task && !task.deletedAt ? task : undefined;
	// Keep the last version on screen while the sheet animates out after a delete.
	const [snapshot, setSnapshot] = useState(current);
	useEffect(() => {
		if (current) setSnapshot(current);
	}, [current]);
	const live = current ?? snapshot;
	// A series paused with its archived habit can't be settled (the store refuses it).
	const habit = useHabit(live?.habitId ?? undefined);
	const liveSeries = useSeries(current ? id : undefined);
	// Keep the series panel while the sheet animates out.
	const seriesRef = useRef(liveSeries);
	if (liveSeries) seriesRef.current = liveSeries;
	const series = live?.repeat != null ? (liveSeries ?? seriesRef.current) : undefined;
	const [open, setOpen] = useState(true);
	const [title, setTitle] = useState(live?.title ?? "");
	const [notes, setNotes] = useState(live?.notes ?? "");
	const committed = useRef(false);

	const commit = () => {
		if (!live || committed.current) return;
		const patch: { title?: string; notes?: string | null } = {};
		if (title.trim() && title.trim() !== live.title) patch.title = title;
		if ((notes.trim() || null) !== live.notes) patch.notes = notes;
		if (Object.keys(patch).length) actions.updateTask(live.id, patch);
	};

	/** Saves the text fields, then closes; `run` acts after the save. */
	const finish = (run?: () => void) => {
		commit();
		committed.current = true;
		run?.();
		setOpen(false);
	};

	// Unknown or already-deleted task (e.g. a stale deep link): just leave.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when nothing was ever shown
	useEffect(() => {
		if (!live) onClosed();
	}, [live]);

	useEffect(() => {
		if (!current && snapshot) setOpen(false);
	}, [current, snapshot]);

	if (!live) return null;

	const status = series?.state.status;
	const repeating = live.repeat != null;
	const unsupported = repeating && !isKnownRule(live.repeat);
	const start = live.date ?? today;
	const barDate = series
		? (occurrence ?? (series.state.status === "active" ? series.state.open : null))
		: null;
	const view = series && barDate ? occurrenceView(series.state, series.logs, barDate) : null;
	// A series paused with its archived habit takes no new settlements (its row's box is locked).
	const actionable =
		!!series &&
		series.state.status !== "paused" &&
		!!barDate &&
		(view === "open" || view === "missed") &&
		canSettleOccurrence(live, series.logs, barDate, today, habit);

	const remove = () => {
		const taskId = live.id;
		finish(() => {
			actions.deleteTask(taskId);
			haptics.medium();
			showToast(t.t("tasks.deleted"), {
				action: { label: t.t("common.undo"), onPress: () => actions.restoreTask(taskId) },
			});
		});
	};

	const changeRepeat = (rule: RepeatRule | null) => {
		// The store keeps the start date (R11/R12); a Someday task starts today.
		actions.updateTask(live.id, { repeat: rule });
	};

	let footer: ReactNode = null;
	if (!series) {
		footer = (
			<View style={styles.footerRow}>
				<Button
					label={t.t("common.delete")}
					icon={Trash2}
					variant="soft"
					size="lg"
					style={{ flex: 1 }}
					onPress={remove}
					testID="task-delete"
				/>
				<Button
					label={live.completedAt ? t.t("habit.markUndone") : t.t("common.done")}
					icon={live.completedAt ? RotateCcw : CircleCheck}
					size="lg"
					style={{ flex: 1.4 }}
					onPress={() =>
						finish(() => {
							actions.toggleTask(live.id);
							if (live.completedAt) {
								haptics.selection();
								return;
							}
							haptics.light();
							showToast(t.t("tasks.completed"), { tone: "success" });
						})
					}
					testID="task-toggle"
				/>
			</View>
		);
	} else if (actionable && barDate) {
		footer = (
			<View style={styles.footerRow}>
				<Button
					label={t.t("tasks.series.skip")}
					icon={SkipForward}
					variant="soft"
					size="lg"
					style={{ flex: 1 }}
					onPress={() => finish(() => occurrenceActions.skip(live, barDate))}
					testID="task-skip"
				/>
				<Button
					label={t.t("common.done")}
					icon={CircleCheck}
					size="lg"
					style={{ flex: 1 }}
					onPress={() => finish(() => occurrenceActions.complete(live, barDate))}
					testID="task-occurrence-done"
				/>
			</View>
		);
	} else if ((view === "done" || view === "skipped") && barDate) {
		footer = (
			<Button
				label={t.t("tasks.series.reopen")}
				icon={RotateCcw}
				variant="soft"
				size="lg"
				onPress={() => finish(() => occurrenceActions.reopen(live, barDate))}
				testID="task-reopen"
			/>
		);
	} else if (status === "ended") {
		footer = (
			<Button
				label={t.t("tasks.series.resume")}
				icon={Repeat}
				size="lg"
				onPress={() => finish(() => occurrenceActions.resume(live))}
				testID="task-resume"
			/>
		);
	}

	const canStop = !!series && (status === "active" || status === "paused");

	return (
		<Sheet
			inline
			scroll
			open={open}
			onClose={() => finish()}
			onClosed={onClosed}
			title={t.t("tasks.edit")}
			closeButton
			testID="task-sheet"
			footer={footer}
		>
			<View style={styles.body}>
				{series ? (
					<SeriesTop
						task={live}
						state={series.state}
						logs={series.logs}
						date={barDate}
						view={view}
					/>
				) : null}
				<SmartTextField
					field="task.title"
					value={title}
					onChangeText={setTitle}
					onBlur={commit}
					placeholder={t.t("tasks.titlePlaceholder")}
					size="lg"
					maxLength={280}
					accessibilityLabel={t.t("tasks.titlePlaceholder")}
					testID="task-title"
				/>
				<View>
					<TextField
						label={t.t("tasks.notes")}
						value={notes}
						onChangeText={setNotes}
						onBlur={commit}
						placeholder={t.t("tasks.notesPlaceholder")}
						multiline
						maxLength={2000}
					/>
					<View style={styles.suggest}>
						<AiSuggestButton
							kind="task.firstStep"
							label={t.t("tasks.notes")}
							disabled={!title.trim()}
							input={() => ({ task: title.trim().slice(0, 200) })}
							onPick={(step) => {
								const next = notes.trim() ? `${notes}\n${step}` : step;
								setNotes(next);
								actions.updateTask(live.id, { notes: next });
							}}
						/>
					</View>
				</View>
				<View style={styles.field}>
					<Text variant="label">{repeating ? t.t("repeat.starts") : t.t("tasks.date")}</Text>
					<DateChips
						value={live.date}
						onChange={(date) => actions.updateTask(live.id, { date })}
						somedayDisabled={repeating}
						bleed={20}
					/>
				</View>
				<View style={styles.field}>
					<Text variant="label">{t.t("repeat.label")}</Text>
					<RepeatRow
						value={live.repeat}
						onChange={changeRepeat}
						start={start}
						weekStartsOn={weekStartsOn}
						disabled={unsupported}
						task={series ? live : undefined}
						logs={series?.logs}
					/>
				</View>
				<View style={styles.field}>
					<Text variant="label">{t.t("tasks.time")}</Text>
					<TimeField
						value={live.time ?? null}
						onChange={(time) => actions.updateTask(live.id, { time })}
						accessibilityLabel={t.t("tasks.time")}
						testID="task-time"
					/>
				</View>
				<View style={styles.field}>
					<Text variant="label">{t.t("tasks.priority")}</Text>
					<PriorityPicker
						value={live.priority}
						onChange={(priority) => actions.updateTask(live.id, { priority })}
					/>
				</View>
				<View style={styles.field}>
					<Text variant="label">{t.t("tasks.habit")}</Text>
					<HabitLinkField
						value={live.habitId ?? null}
						onChange={(habitId) =>
							// A manual (re)link isn't tied to a habit field.
							actions.updateTask(live.id, { habitId, law: null, habitField: null })
						}
					/>
				</View>
				{series ? (
					<>
						<View style={styles.divider} />
						<SeriesHistory task={live} state={series.state} logs={series.logs} />
						<View style={styles.ghostRow}>
							{canStop ? (
								<Button
									label={t.t("tasks.series.end")}
									icon={X}
									variant="soft"
									size="sm"
									onPress={() => finish(() => occurrenceActions.end(live))}
									testID="task-end-series"
								/>
							) : null}
							<Button
								label={t.t("common.delete")}
								icon={Trash2}
								variant="soft"
								size="sm"
								onPress={remove}
								testID="task-delete"
							/>
						</View>
					</>
				) : null}
			</View>
		</Sheet>
	);
}

function occurrenceView(
	state: SeriesState,
	logs: readonly TaskLog[],
	date: DayKey,
): OccurrenceView {
	const log = logs.find((l) => l.date === date) ?? null;
	if (log) return log.status;
	if (date === state.open) return "open";
	return state.open === null || date < state.open ? "missed" : "projected";
}

/**
 * The top of a series' sheet: why it can't be acted on (paused, stopped,
 * finished, newer rule) and the occurrence it was opened for with its state
 * ("This occurrence · Today", "Overdue · 3 missed", "Done · 2 days late").
 */
function SeriesTop({
	task,
	state,
	logs,
	date,
	view,
}: {
	task: Task;
	state: SeriesState;
	logs: readonly TaskLog[];
	date: DayKey | null;
	view: OccurrenceView | null;
}) {
	const t = useT();
	const text = useText();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const habit = useHabit(task.habitId ?? undefined);
	const log = logs.find((l) => l.date === date) ?? null;
	const late = log ? Math.max(0, diffDays(log.resolvedOn, log.date)) : 0;

	let notice: { icon: LucideIcon; text: string } | null = null;
	if (state.status === "paused" && habit) {
		notice = {
			icon: Archive,
			text: t.t("tasks.series.paused", { habit: text.habit(habit, "name") }),
		};
	} else if (state.status === "unsupported") {
		notice = { icon: Info, text: t.t("tasks.series.unsupported") };
	} else if (state.status === "ended") {
		notice = { icon: Repeat, text: t.t("tasks.series.ended") };
	} else if (state.status === "finished" && !date) {
		notice = {
			icon: CircleCheck,
			text: `${t.t("tasks.series.finished")} · ${t.tp("common.times", state.doneCount)}`,
		};
	}

	const status: { key: string; text: string; color?: string; icon?: LucideIcon }[] = [];
	if (view === "open" && date && date < today)
		status.push({ key: "overdue", text: t.t("tasks.group.overdue"), color: colors.danger });
	if (view === "open" && state.missed > 0)
		status.push({ key: "missed", text: t.tp("tasks.series.missed", state.missed) });
	if (view === "done") {
		status.push(
			{
				key: "done",
				text: t.t("tasks.series.doneState"),
				color: colors.success,
				icon: Check,
			},
			{
				key: "late",
				text: late > 0 ? t.tp("tasks.series.late", late) : t.t("tasks.series.onTime"),
			},
		);
	}
	if (view === "skipped") status.push({ key: "skipped", text: t.t("tasks.series.skipped") });
	if (view === "missed") status.push({ key: "missed", text: t.t("tasks.series.missedState") });
	if (view === "projected") status.push({ key: "projected", text: t.t("tasks.series.projected") });

	// Paused or a newer rule: the notice says why there is nothing to act on.
	const showBar = !!date && state.status !== "unsupported" && state.status !== "paused";
	if (!notice && !showBar) return null;
	const heading = date
		? t.t("tasks.series.thisOne", { date: t.formatRelativeDay(date, today) })
		: "";

	return (
		<View style={styles.top}>
			{notice ? (
				<View style={styles.notice} accessible accessibilityLabel={notice.text}>
					<notice.icon size={16} color={colors.textMuted} strokeWidth={2} />
					<Text variant="small" tone="muted" style={styles.noticeText}>
						{notice.text}
					</Text>
				</View>
			) : null}
			{showBar ? (
				<View
					style={styles.bar}
					accessible
					accessibilityLabel={[heading, ...status.map((s) => s.text)].join(", ")}
					testID="occurrence-bar"
				>
					<Text variant="small" weight="semibold">
						{heading}
					</Text>
					{status.length ? (
						<View style={styles.statusRow}>
							{status.map((item, index) => (
								<View key={item.key} style={styles.statusItem}>
									{index > 0 ? (
										<Text variant="small" tone="subtle">
											·
										</Text>
									) : null}
									{item.icon ? <item.icon size={13} color={item.color} strokeWidth={3} /> : null}
									<Text
										variant="small"
										weight={item.color ? "semibold" : "regular"}
										color={item.color}
										tone="muted"
									>
										{item.text}
									</Text>
								</View>
							))}
						</View>
					) : null}
				</View>
			) : null}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 18, paddingBottom: 8 },
	field: { gap: 8 },
	suggest: { flexDirection: "row", justifyContent: "flex-end" },
	footerRow: { flexDirection: "row", gap: 10 },
	divider: { height: 1, backgroundColor: t.colors.border, marginVertical: 2 },
	ghostRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	top: { gap: 10 },
	notice: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	noticeText: { flex: 1 },
	bar: {
		gap: 4,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.sunken,
	},
	statusRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6 },
	statusItem: { flexDirection: "row", alignItems: "center", gap: 6 },
}));
