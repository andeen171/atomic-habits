import { ChevronLeft, ChevronRight, Power } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { useTrackerActions } from "@/lib/use-tracker-actions";
import {
	type Habit,
	type PeriodKind,
	type TrackerConfig,
	trackerActionLabel,
	trackerName,
} from "@atomic/core";
import {
	type TrackerInfo,
	useActions,
	usePeriod,
	useToday,
	useTracker,
	useTrackerEntries,
	useTrackerSuggestion,
	useTrackerSummary,
} from "@atomic/core/react";
import { useMemo } from "react";
import { View } from "react-native";
import { trackerCaps } from "./caps";
import { Shelf } from "./shelf";
import { SummaryBlocks } from "./summary-blocks";
import { TRACKER_ICONS } from "./tracker-icon";
import { TrackerSuggestionCard } from "./tracker-suggestion-card";

export interface TrackerPanelProps {
	habit: Habit;
}

/**
 * Habit page (spec §6 item 4): the tracker suggestion card when the habit
 * has none and one fits, otherwise the summary panel (Week / Month / Year
 * with ‹ ›, stats, budget, chart, breakdowns, lists, the reading shelf). A
 * tracker that was switched off keeps its history readable here. Renders
 * its own card and spacing; nothing for plain habits. Owner: T4.
 */
export function TrackerPanel({ habit }: TrackerPanelProps) {
	const tracker = useTracker(habit);
	const suggestion = useTrackerSuggestion(habit);
	const entries = useTrackerEntries(tracker && !tracker.active ? habit.id : undefined);
	if (!tracker)
		return suggestion ? <TrackerSuggestionCard habit={habit} type={suggestion} /> : null;
	if (!tracker.active && entries.length === 0) return null;
	return <SummaryPanel habit={habit} tracker={tracker} />;
}

function SummaryPanel({ habit, tracker }: { habit: Habit; tracker: TrackerInfo }) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const actions = useActions();
	const { openTracker } = useTrackerActions();
	const caps = useMemo(() => trackerCaps(), []);
	const [period, controls] = usePeriod("month");
	const summary = useTrackerSummary(habit, period, caps);
	const type = tracker.config.type;
	const name = trackerName(type, t);
	const editable = tracker.active && !habit.archivedAt;
	const hasShelf = summary.blocks.some((block) => block.kind === "shelf");
	const tone = toneOf(habit.color);
	const Icon = TRACKER_ICONS[type];

	const reenable = () => {
		actions.setTracker(habit.id, { ...tracker.config, enabled: true } as TrackerConfig);
		haptics.success();
		showToast(`${t.t("tracker.reenabled", { tracker: name })} · ${t.t("tracker.startsToday")}`, {
			tone: "success",
		});
	};

	return (
		<View style={styles.card} testID="tracker-panel">
			<View style={styles.header}>
				<View style={[styles.tile, { backgroundColor: tone.soft }]}>
					<Text style={styles.emoji} allowFontScaling={false}>
						{tracker.def.emoji}
					</Text>
				</View>
				<View style={styles.grow}>
					<Text variant="h3" accessibilityRole="header">
						{name}
					</Text>
					<Text variant="small" tone="muted">
						{habit.archivedAt
							? t.t("tracker.archived")
							: tracker.active
								? t.t("tracker.strictHint")
								: t.t("tracker.offBody")}
					</Text>
				</View>
			</View>
			{!tracker.active && !habit.archivedAt ? (
				<Button
					label={t.t("tracker.reenable", { tracker: name })}
					icon={Power}
					variant="secondary"
					size="sm"
					onPress={reenable}
					style={styles.start}
				/>
			) : null}

			<View style={styles.periods}>
				<SegmentedControl<PeriodKind>
					size="sm"
					accessibilityLabel={t.t("tracker.period.label")}
					value={period.kind}
					onChange={controls.setKind}
					segments={[
						{ value: "week", label: t.t("tracker.period.week") },
						{ value: "month", label: t.t("tracker.period.month") },
						{ value: "year", label: t.t("tracker.period.year") },
					]}
				/>
				<View style={styles.nav}>
					<IconButton
						icon={ChevronLeft}
						variant="soft"
						size={34}
						iconSize={18}
						accessibilityLabel={t.t("tracker.period.previous")}
						onPress={() => {
							haptics.selection();
							controls.prev();
						}}
						testID="tracker-period-prev"
					/>
					<View style={styles.periodLabel}>
						<Text
							weight="semibold"
							variant="small"
							align="center"
							tabular
							numberOfLines={1}
							accessibilityLiveRegion="polite"
						>
							{period.label}
						</Text>
						{controls.canNext ? (
							<PressableScale
								onPress={() => {
									haptics.selection();
									controls.reset();
								}}
								hitSlop={10}
								accessibilityRole="button"
								accessibilityLabel={t.t("tracker.period.current")}
								style={styles.reset}
								testID="tracker-period-reset"
							>
								<Text variant="tiny" tone="accent" weight="semibold" align="center">
									{t.t("tracker.period.current")}
								</Text>
							</PressableScale>
						) : null}
					</View>
					<IconButton
						icon={ChevronRight}
						variant="soft"
						size={34}
						iconSize={18}
						accessibilityLabel={t.t("tracker.period.next")}
						disabled={!controls.canNext}
						onPress={() => {
							haptics.selection();
							controls.next();
						}}
						testID="tracker-period-next"
					/>
				</View>
			</View>

			{type === "reading" && !hasShelf ? (
				<Shelf habit={habit} block={null} editable={editable} />
			) : null}
			{summary.blocks.length ? (
				<SummaryBlocks habit={habit} blocks={summary.blocks} period={period} editable={editable} />
			) : null}
			{summary.empty ? (
				<View style={styles.empty}>
					<Text style={styles.emptyEmoji} allowFontScaling={false}>
						{tracker.def.emoji}
					</Text>
					<Text tone="muted" align="center" style={styles.emptyText}>
						{summary.emptyText}
					</Text>
					{/* A clean period on a break habit is the goal, not a gap to fill: no "I slipped" here. */}
					{editable && !controls.canNext && habit.kind !== "break" ? (
						<Button
							label={trackerActionLabel(type, t, tracker.config)}
							icon={Icon}
							variant="soft"
							size="sm"
							onPress={() => openTracker(habit, today)}
						/>
					) : null}
				</View>
			) : null}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		gap: 18,
		padding: 16,
		marginBottom: 22,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		...t.cardShadow,
	},
	header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
	tile: {
		width: 40,
		height: 40,
		borderRadius: 13,
		alignItems: "center",
		justifyContent: "center",
	},
	emoji: { fontSize: 20, lineHeight: 26 },
	grow: { flex: 1 },
	start: { alignSelf: "flex-start", marginTop: -6 },
	periods: { gap: 10 },
	nav: { flexDirection: "row", alignItems: "center", gap: 8 },
	periodLabel: { flex: 1, alignItems: "center", minHeight: 34, justifyContent: "center" },
	reset: { paddingVertical: 2 },
	empty: {
		alignItems: "center",
		gap: 10,
		paddingHorizontal: 18,
		paddingVertical: 24,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
	},
	emptyEmoji: { fontSize: 30, lineHeight: 38 },
	emptyText: { maxWidth: 300 },
}));
