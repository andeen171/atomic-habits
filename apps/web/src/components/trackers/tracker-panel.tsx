import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
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
import { ChevronLeft, ChevronRight, Power } from "lucide-react";
import { useId, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { SegmentedControl } from "../ui/segmented";
import { trackerCaps } from "./caps";
import { Shelf } from "./shelf";
import { SummaryBlocks } from "./summary-blocks";
import { TrackerSuggestionCard } from "./tracker-suggestion-card";

export interface TrackerPanelProps {
	habit: Habit;
}

/**
 * Right under the habit page hero (spec §5.3 item 2): the tracker
 * suggestion card when the habit has none and one fits, otherwise the
 * summary panel (Week / Month / Year, stats, budget, chart). A tracker that
 * was switched off keeps its history readable here. Owner: T4.
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
	const { t } = useT();
	const style = useHabitStyle(habit.color);
	const titleId = useId();
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

	const reenable = () => {
		actions.setTracker(habit.id, { ...tracker.config, enabled: true } as TrackerConfig);
		toast(t("tracker.reenabled", { tracker: name }), { description: t("tracker.startsToday") });
	};

	return (
		<section
			aria-labelledby={titleId}
			style={style}
			className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 shadow-card md:p-6"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
					<span
						aria-hidden="true"
						className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-xl"
					>
						{tracker.def.emoji}
					</span>
					<div className="min-w-0">
						<h2 id={titleId} className="break-words font-semibold text-h3 text-ink">
							{name}
						</h2>
						<p className="text-ink-muted text-small">
							{habit.archivedAt
								? t("tracker.archived")
								: tracker.active
									? t("tracker.strictHint")
									: t("tracker.offBody")}
						</p>
					</div>
				</div>
				{editable ? (
					<Button size="sm" onClick={() => openTracker(habit, today)} className="shrink-0">
						{trackerActionLabel(type, t)}
					</Button>
				) : !tracker.active && !habit.archivedAt ? (
					<Button size="sm" variant="secondary" onClick={reenable} className="shrink-0">
						<Power />
						{t("tracker.reenable", { tracker: name })}
					</Button>
				) : null}
			</div>

			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<SegmentedControl<PeriodKind>
					label={t("tracker.period.label")}
					size="sm"
					value={period.kind}
					onChange={controls.setKind}
					options={[
						{ value: "week", label: t("tracker.period.week") },
						{ value: "month", label: t("tracker.period.month") },
						{ value: "year", label: t("tracker.period.year") },
					]}
				/>
				<div className="flex min-w-0 items-center gap-1">
					<IconButton label={t("tracker.period.previous")} size="sm" onClick={controls.prev}>
						<ChevronLeft />
					</IconButton>
					<p
						aria-live="polite"
						className="min-w-0 px-1 text-center font-medium text-ink text-small tabular-nums"
					>
						{period.label}
					</p>
					<IconButton
						label={t("tracker.period.next")}
						size="sm"
						disabled={!controls.canNext}
						onClick={controls.next}
					>
						<ChevronRight />
					</IconButton>
					{controls.canNext ? (
						<Button variant="link" size="sm" onClick={controls.reset} className="ml-1">
							{t("tracker.period.current")}
						</Button>
					) : null}
				</div>
			</div>

			{type === "reading" && !hasShelf ? (
				<Shelf habit={habit} block={null} editable={editable} />
			) : null}
			{summary.blocks.length ? (
				<SummaryBlocks habit={habit} blocks={summary.blocks} period={period} editable={editable} />
			) : null}
			{summary.empty ? (
				<div className="flex flex-col items-center gap-3 rounded-xl border border-line border-dashed px-5 py-8 text-center">
					<span aria-hidden="true" className="font-emoji text-3xl">
						{tracker.def.emoji}
					</span>
					<p className="max-w-sm text-balance text-ink-muted">{summary.emptyText}</p>
					{editable && controls.canNext === false ? (
						<Button size="sm" variant="soft" onClick={() => openTracker(habit, today)}>
							{trackerActionLabel(type, t)}
						</Button>
					) : null}
				</div>
			) : null}
		</section>
	);
}
