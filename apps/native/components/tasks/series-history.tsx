import { Check, ChevronDown, Minus, Undo2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type SeriesHistoryEntry,
	type SeriesState,
	type Task,
	type TaskLog,
	canSettleOccurrence,
	isKnownRule,
} from "@atomic/core";
import { useHabit, useSeriesHistory, useToday } from "@atomic/core/react";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useOccurrenceActions, weekdayDateLabel } from "./use-occurrence-actions";

/** The strip shows the most recent entries; the list the most recent dozen. */
const STRIP = 8;
const LIST = 12;

interface SeriesHistoryProps {
	task: Task;
	state: SeriesState;
	logs: readonly TaskLog[];
}

/**
 * A series' history (Annex T §5.3): "Done N times", a strip of the latest
 * occurrences (● done, ○ missed, – skipped; read out as one line) and a
 * collapsible list with "n days late", Undo on settled entries and "Mark
 * done" to backfill missed ones (fixed rules, R7).
 */
export function SeriesHistory({ task, state, logs }: SeriesHistoryProps) {
	const t = useT();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	const entries = useSeriesHistory(task.id, LIST);
	const habit = useHabit(task.habitId ?? undefined);
	const occurrence = useOccurrenceActions();
	const readOnly = state.status === "unsupported";
	// Paused with its archived habit: nothing new is settled (the row's box is locked too); undo stays.
	const paused = state.status === "paused";
	const strip = entries.slice(0, STRIP).reverse();

	const stateText = (entry: SeriesHistoryEntry) =>
		entry.state === "done"
			? t.t("tasks.series.doneState")
			: entry.state === "skipped"
				? t.t("tasks.series.skipped")
				: t.t("tasks.series.missedState");

	const heading =
		state.doneCount > 0
			? `${t.t("tasks.series.history")} · ${t.tp("tasks.series.doneCount", state.doneCount)}`
			: t.t("tasks.series.history");

	return (
		<View style={styles.wrap}>
			<Pressable
				onPress={() => {
					if (!entries.length) return;
					haptics.selection();
					setOpen((v) => !v);
				}}
				disabled={!entries.length}
				accessibilityRole="button"
				accessibilityState={{ expanded: open, disabled: !entries.length }}
				accessibilityLabel={heading}
				accessibilityHint={
					strip.length
						? strip
								.map((entry) => `${t.formatDayShort(entry.date)}: ${stateText(entry)}`)
								.join(", ")
						: undefined
				}
				style={styles.header}
				testID="series-history-toggle"
			>
				<View style={styles.headingRow}>
					{entries.length ? (
						<ChevronDown
							size={16}
							color={colors.textSubtle}
							style={{ transform: [{ rotate: open ? "0deg" : "-90deg" }] }}
						/>
					) : null}
					<Text variant="label" tone="subtle" numberOfLines={2} style={styles.heading}>
						{heading}
					</Text>
				</View>
				{strip.length ? (
					<View style={styles.strip}>
						{strip.map((entry) => (
							<StateDot key={entry.date} state={entry.state} />
						))}
					</View>
				) : null}
			</Pressable>
			{!entries.length ? (
				<Text variant="small" tone="subtle">
					{t.t("tasks.series.historyEmpty")}
				</Text>
			) : null}
			{open && entries.length ? (
				<Animated.View
					entering={FadeIn.duration(180)}
					exiting={FadeOut.duration(120)}
					layout={LinearTransition}
					style={styles.list}
					testID="series-history-list"
				>
					{entries.map((entry, index) => {
						const date = t.formatDayShort(entry.date);
						const backfill =
							!readOnly &&
							!paused &&
							entry.state === "missed" &&
							isKnownRule(task.repeat) &&
							canSettleOccurrence(task, logs, entry.date, today, habit);
						const detail =
							entry.state === "done"
								? `${stateText(entry)} · ${entry.late > 0 ? t.tp("tasks.series.late", entry.late) : t.t("tasks.series.onTime")}`
								: stateText(entry);
						return (
							<View key={entry.date} style={[styles.item, index > 0 && styles.itemSeparator]}>
								<View style={styles.dotSlot}>
									<StateDot state={entry.state} />
								</View>
								<View
									style={styles.itemText}
									accessible
									accessibilityLabel={`${weekdayDateLabel(entry.date, t, true)}, ${detail}`}
								>
									<Text variant="small" weight="medium">
										{weekdayDateLabel(entry.date, t, true)}
									</Text>
									<Text
										variant="tiny"
										weight="medium"
										tone={entry.state === "done" ? "muted" : "subtle"}
									>
										{detail}
									</Text>
								</View>
								{readOnly ? null : entry.state === "missed" ? (
									backfill ? (
										<Button
											label={t.t("tasks.series.markDone")}
											icon={Check}
											variant="ghost"
											size="sm"
											onPress={() => occurrence.complete(task, entry.date)}
											testID={`history-backfill-${entry.date}`}
										/>
									) : null
								) : (
									<IconButton
										icon={Undo2}
										size={36}
										iconSize={18}
										color={colors.textMuted}
										accessibilityLabel={t.t("tasks.series.reopenDate", { date })}
										onPress={() => occurrence.reopen(task, entry.date)}
										testID={`history-reopen-${entry.date}`}
									/>
								)}
							</View>
						);
					})}
				</Animated.View>
			) : null}
		</View>
	);
}

/** ● done, – skipped, ○ missed (shape, not only colour, carries the state). */
function StateDot({ state }: { state: SeriesHistoryEntry["state"] }) {
	const theme = useTheme();
	const { colors } = theme;
	const styles = useStyles();
	if (state === "done") {
		return (
			<View style={[styles.dot, { backgroundColor: colors.success }]}>
				<Check size={10} color={theme.onStatus.success} strokeWidth={3.5} />
			</View>
		);
	}
	if (state === "skipped") {
		return (
			<View style={[styles.dot, styles.dotSkipped]}>
				<Minus size={10} color={colors.textMuted} strokeWidth={3.5} />
			</View>
		);
	}
	return <View style={[styles.dot, styles.dotMissed]} />;
}

const useStyles = makeStyles((t) => ({
	wrap: { gap: 10 },
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		flexWrap: "wrap",
		gap: 10,
		minHeight: 32,
	},
	headingRow: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
	heading: { flexShrink: 1 },
	strip: { flexDirection: "row", alignItems: "center", gap: 5 },
	dot: {
		width: 16,
		height: 16,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
	},
	dotSkipped: {
		backgroundColor: t.colors.sunken,
		borderWidth: 1,
		borderColor: t.colors.borderStrong,
	},
	dotMissed: { borderWidth: 1.5, borderStyle: "dashed", borderColor: t.colors.borderStrong },
	list: {
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		overflow: "hidden",
	},
	item: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 52,
		paddingLeft: 14,
		paddingRight: 6,
		paddingVertical: 6,
	},
	itemSeparator: { borderTopWidth: 1, borderTopColor: t.colors.border },
	dotSlot: { width: 20, alignItems: "center" },
	itemText: { flex: 1, gap: 1 },
}));
