import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Habit, Period, StatItem, SummaryBlock, Tone } from "@atomic/core";
import { useActions, useAtomicStore, useToday, useTrackerHeadline } from "@atomic/core/react";
import { AlertTriangle, ChevronRight, CircleCheck, ImageOff, Info } from "lucide-react";
import type { ReactNode } from "react";
import { ProgressBar, type ProgressTone } from "../ui/progress-bar";
import { TrackerChart } from "./charts";
import { Shelf } from "./shelf";

/**
 * Renders a tracker summary's blocks (Annex K §3.5, §4.1): stat tiles,
 * charts, breakdowns, the expense budget, lists, notes and the reading shelf.
 * Everything arrives translated and formatted from core; this only lays it
 * out. Lists and stat tones never rely on colour alone (their text says
 * "less", "over budget"…, and warnings carry an icon). Owner: T4.
 */
export interface SummaryBlocksProps {
	habit: Habit;
	blocks: readonly SummaryBlock[];
	period: Period;
	/** Rows link to their entries (off for archived habits). */
	editable: boolean;
}

export function SummaryBlocks({ habit, blocks, period, editable }: SummaryBlocksProps) {
	const isLead = (b: SummaryBlock) =>
		b.kind === "stats" || b.kind === "progress" || b.kind === "shelf";
	const lead = blocks.filter(isLead);
	const charts = blocks.filter((b) => b.kind === "chart");
	const rest = blocks.filter((b) => !isLead(b) && b.kind !== "chart");
	return (
		<div className="flex flex-col gap-6">
			{lead.map((block) => (
				<Block key={block.id} habit={habit} block={block} period={period} editable={editable} />
			))}
			{charts.map((block) => (
				<Block key={block.id} habit={habit} block={block} period={period} editable={editable} />
			))}
			{rest.length ? (
				<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
					{rest.map((block) => (
						<Block key={block.id} habit={habit} block={block} period={period} editable={editable} />
					))}
				</div>
			) : null}
		</div>
	);
}

function Block({
	habit,
	block,
	period,
	editable,
}: {
	habit: Habit;
	block: SummaryBlock;
	period: Period;
	editable: boolean;
}) {
	switch (block.kind) {
		case "stats":
			return <StatsBlock items={block.items} />;
		case "chart":
			return (
				<BlockSection title={block.title}>
					<TrackerChart block={block} />
				</BlockSection>
			);
		case "breakdown":
			return <BreakdownBlock block={block} />;
		case "progress":
			return <ProgressBlock habit={habit} block={block} period={period} />;
		case "list":
			return <ListBlock habit={habit} block={block} editable={editable} />;
		case "note":
			return <NoteBlock text={block.text} tone={block.tone} />;
		case "shelf":
			return <Shelf habit={habit} block={block} editable={editable} />;
		case "plan":
			return <PlanBlock block={block} editable={editable} />;
		case "gallery":
		case "compare":
			return <PhotosOffBlock title={block.title} />;
	}
}

function BlockSection({
	title,
	children,
	action,
}: {
	title: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<section className="flex min-w-0 flex-col gap-3">
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="section-label">{title}</h3>
				{action}
			</div>
			{children}
		</section>
	);
}

export const toneText: Record<Tone, string> = {
	default: "text-ink-muted",
	good: "text-success",
	warning: "text-warning",
	danger: "text-danger",
};

// ── Stats ─────────────────────────────────────────────────────────────────

function StatsBlock({ items }: { items: readonly StatItem[] }) {
	return (
		<dl className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
			{items.map((item) => (
				<div
					key={item.id}
					className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface px-3.5 py-3"
				>
					<dt className="section-label line-clamp-2 break-words">{item.label}</dt>
					<dd
						className={cn(
							"break-words font-semibold text-ink tabular-nums leading-tight",
							item.value.length > 10 ? "text-h3" : "text-h2",
						)}
					>
						{item.value}
					</dd>
					{item.hint ? (
						<dd className={cn("break-words text-small", toneText[item.tone ?? "default"])}>
							{item.hint}
						</dd>
					) : null}
				</div>
			))}
		</dl>
	);
}

// ── Breakdown ─────────────────────────────────────────────────────────────

function BreakdownBlock({ block }: { block: Extract<SummaryBlock, { kind: "breakdown" }> }) {
	const { t } = useT();
	const top = Math.max(...block.items.map((item) => item.share), 0.0001);
	return (
		<BlockSection title={block.title}>
			<ul className="flex flex-col gap-2.5">
				{block.items.map((item) => (
					<li key={item.key} className="flex flex-col gap-1">
						<div className="flex items-baseline gap-2 text-small">
							{item.emoji ? (
								<span aria-hidden="true" className="shrink-0 font-emoji">
									{item.emoji}
								</span>
							) : null}
							<span className="min-w-0 flex-1 truncate text-ink">{item.label}</span>
							<span className="shrink-0 font-medium text-ink tabular-nums">{item.formatted}</span>
							<span className="w-10 shrink-0 text-right text-ink-subtle text-tiny tabular-nums">
								{t.percent(item.share)}
							</span>
						</div>
						<div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-heat-0">
							<div
								className="h-full rounded-full bg-(--habit)"
								style={{ width: `${Math.max(2, (item.share / top) * 100)}%` }}
							/>
						</div>
					</li>
				))}
			</ul>
		</BlockSection>
	);
}

// ── Progress (the expense budget) ─────────────────────────────────────────

const progressTone: Record<Tone, ProgressTone> = {
	default: "habit",
	good: "success",
	warning: "warning",
	danger: "danger",
};

function ProgressBlock({
	habit,
	block,
	period,
}: {
	habit: Habit;
	block: Extract<SummaryBlock, { kind: "progress" }>;
	period: Period;
}) {
	const today = useToday();
	const thisMonth = useTrackerHeadline(block.id === "budget" ? habit : undefined);
	const parts = (block.caption ?? "").split(" · ").filter(Boolean);
	const current = period.from <= today && today <= period.to;
	// The budget leads with what's left ("R$ 320 left this month"); the pace follows the bar.
	const headline =
		block.id === "budget" ? ((current ? thisMonth : null) ?? parts[0] ?? null) : null;
	const rest = block.id === "budget" ? parts.slice(1) : parts;
	const warn = block.tone === "warning" || block.tone === "danger";
	return (
		<section className="flex flex-col gap-2.5 rounded-xl bg-sunken/60 p-4 md:p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h3 className="section-label">{block.title}</h3>
				<span className="text-ink-muted text-small tabular-nums">{block.formatted}</span>
			</div>
			{headline ? (
				<p
					className={cn(
						"flex items-center gap-2 font-display text-[1.75rem] leading-tight",
						block.tone === "danger" ? "text-danger" : "text-ink",
					)}
				>
					{block.tone === "danger" ? (
						<AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
					) : null}
					{headline}
				</p>
			) : null}
			<ProgressBar
				value={block.value}
				max={block.max}
				label={block.title}
				valueText={[block.formatted, headline, ...rest].filter(Boolean).join(" · ")}
				tone={progressTone[block.tone]}
			/>
			{rest.length ? (
				<p
					className={cn(
						"flex items-start gap-1.5 text-small",
						toneText[warn ? block.tone : "default"],
					)}
				>
					{block.tone === "warning" ? (
						<AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					) : null}
					{rest.join(" · ")}
				</p>
			) : null}
		</section>
	);
}

// ── Lists, notes, plan ────────────────────────────────────────────────────

function ListBlock({
	habit,
	block,
	editable,
}: {
	habit: Habit;
	block: Extract<SummaryBlock, { kind: "list" }>;
	editable: boolean;
}) {
	const openEntryComposer = useUI((s) => s.openEntryComposer);
	const store = useAtomicStore();
	const edit = (entryId: string) => {
		const entry = store.getState().data.trackerEntries[entryId];
		if (entry && !entry.deletedAt) {
			openEntryComposer({ habitId: habit.id, day: entry.date, entryId });
		}
	};
	return (
		<BlockSection title={block.title}>
			{block.items.length ? (
				<ul className="-mx-2 flex flex-col">
					{block.items.map((item) => {
						const content = (
							<>
								{item.tone === "warning" || item.tone === "danger" ? (
									<AlertTriangle
										aria-hidden="true"
										className={cn("mt-0.5 size-4 shrink-0", toneText[item.tone])}
									/>
								) : null}
								<span className="min-w-0 flex-1">
									<span
										className={cn(
											"block break-words text-small",
											item.tone && item.tone !== "default" ? toneText[item.tone] : "text-ink",
										)}
									>
										{item.primary}
									</span>
									{item.secondary ? (
										<span className="block break-words text-ink-subtle text-tiny">
											{item.secondary}
										</span>
									) : null}
								</span>
								{item.trailing ? (
									<span className="shrink-0 font-medium text-ink text-small tabular-nums">
										{item.trailing}
									</span>
								) : null}
							</>
						);
						return (
							<li key={item.id}>
								{editable && item.entryId ? (
									<button
										type="button"
										onClick={() => item.entryId && edit(item.entryId)}
										className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover"
									>
										{content}
										<ChevronRight
											aria-hidden="true"
											className="mt-0.5 size-4 shrink-0 text-ink-subtle"
										/>
									</button>
								) : (
									<div className="flex items-start gap-2.5 px-2 py-2">{content}</div>
								)}
							</li>
						);
					})}
				</ul>
			) : block.emptyLabel ? (
				<p className="text-ink-subtle text-small">{block.emptyLabel}</p>
			) : null}
		</BlockSection>
	);
}

function NoteBlock({ text, tone }: { text: string; tone: Tone }) {
	const Icon = tone === "warning" || tone === "danger" ? AlertTriangle : Info;
	return (
		<p
			className={cn(
				"flex items-start gap-2 rounded-lg bg-sunken/70 px-3.5 py-3 text-small",
				tone === "default" ? "text-ink-muted" : toneText[tone],
			)}
		>
			<Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			{text}
		</p>
	);
}

function PlanBlock({
	block,
	editable,
}: {
	block: Extract<SummaryBlock, { kind: "plan" }>;
	editable: boolean;
}) {
	const actions = useActions();
	return (
		<BlockSection title={block.title}>
			<ul className="flex flex-col gap-1.5">
				{block.items.map((item, index) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: plan lines are ordered and may repeat.
						key={index}
						className="flex items-start gap-2.5 text-small"
					>
						{item.taskId && editable ? (
							<input
								type="checkbox"
								checked={item.done}
								onChange={() => item.taskId && actions.toggleTask(item.taskId)}
								aria-label={item.text}
								className="mt-0.5 size-4 shrink-0 accent-(--accent)"
							/>
						) : (
							<CircleCheck
								aria-hidden="true"
								className={cn(
									"mt-0.5 size-4 shrink-0",
									item.done ? "text-success" : "text-ink-subtle",
								)}
							/>
						)}
						<span
							className={cn(
								"min-w-0 break-words",
								item.done ? "text-ink-muted line-through" : "text-ink",
							)}
						>
							{item.text}
						</span>
					</li>
				))}
			</ul>
		</BlockSection>
	);
}

function PhotosOffBlock({ title }: { title: string }) {
	const { t } = useT();
	return (
		<BlockSection title={title}>
			<p className="flex items-center gap-2 text-ink-muted text-small">
				<ImageOff aria-hidden="true" className="size-4 shrink-0" />
				{t("tracker.photosOff")}
			</p>
		</BlockSection>
	);
}
