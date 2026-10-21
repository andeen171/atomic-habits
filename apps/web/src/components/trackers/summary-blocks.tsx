import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
	type GalleryPhoto,
	type Habit,
	type Period,
	type StatItem,
	type SummaryBlock,
	type Tone,
	diffDays,
	knownTracker,
	photoAlt,
} from "@atomic/core";
import { useActions, useAtomicStore, useToday, useTrackerHeadline } from "@atomic/core/react";
import {
	AlertTriangle,
	Check,
	ChevronRight,
	CircleCheck,
	Columns2,
	ImageOff,
	Info,
	Plus,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { ProgressBar, type ProgressTone } from "../ui/progress-bar";
import { trackerCaps } from "./caps";
import { TrackerChart } from "./charts";
import { PhotoThumb } from "./photo-thumb";
import { Shelf } from "./shelf";
import { type ViewerPhoto, openComposerWith, useTrackerUI } from "./tracker-ui";

/**
 * Renders a tracker summary's blocks (Annex K §3.5, §4.1): stat tiles,
 * charts, breakdowns, the expense budget, lists, notes, the reading shelf,
 * and a photo journal's gallery and then-and-now pair.
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
	// Full-width blocks first (stats, budget, plan, shelf, then and now, the gallery), then charts.
	const isLead = (b: SummaryBlock) =>
		b.kind === "plan" ||
		b.kind === "stats" ||
		b.kind === "progress" ||
		b.kind === "shelf" ||
		b.kind === "compare" ||
		b.kind === "gallery";
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
			return trackerCaps().photos ? (
				<GalleryBlock habit={habit} block={block} />
			) : (
				<PhotosOffBlock title={block.title} />
			);
		case "compare":
			return trackerCaps().photos ? (
				<CompareBlock habit={habit} block={block} />
			) : (
				<PhotosOffBlock title={block.title} />
			);
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

/** Columns by tile count, so no row ends with a lone tile (5 → 3 + 2, then one row of 5). */
function statColumns(count: number): string {
	if (count === 5) return "grid-cols-2 @lg:grid-cols-3 @3xl:grid-cols-5";
	if (count === 3 || count === 6) return "grid-cols-2 @lg:grid-cols-3";
	return "grid-cols-2 @xl:grid-cols-4";
}

function StatsBlock({ items }: { items: readonly StatItem[] }) {
	return (
		<div className="@container">
			<StatGrid items={items} />
		</div>
	);
}

function StatGrid({ items }: { items: readonly StatItem[] }) {
	return (
		<dl className={cn("grid @xl:gap-3 gap-2.5", statColumns(items.length))}>
			{items.map((item) => (
				<div
					key={item.id}
					className="@container flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface px-3.5 py-3"
				>
					<dt className="section-label line-clamp-2 break-words">{item.label}</dt>
					{/* Never broken mid-number ("R$ 442,5|0"): sized to the tile instead, h2 at most. */}
					<dd
						title={item.value}
						className={cn(
							"overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-ink tabular-nums leading-tight",
							item.value.length > 10
								? "text-[length:clamp(0.9375rem,12cqi,1.0625rem)]"
								: "text-[length:clamp(1rem,16cqi,1.375rem)]",
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
	const { t } = useT();
	const today = useToday();
	const openEntryComposer = useUI((s) => s.openEntryComposer);
	const store = useAtomicStore();
	const edit = (entryId: string) => {
		const entry = store.getState().data.trackerEntries[entryId];
		if (entry && !entry.deletedAt) {
			openEntryComposer({ habitId: habit.id, day: entry.date, entryId });
		}
	};
	// "Your circle": a person's row logs a connection with them (the nudge becomes the action).
	const config = knownTracker(habit);
	const circle = block.id === "circle" && config?.type === "connection" ? config.circle : null;
	const personOf = (id: string) => circle?.[Number(id.slice(id.indexOf(":") + 1))]?.name ?? null;
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
						const person = editable && !item.entryId ? personOf(item.id) : null;
						return (
							<li key={item.id}>
								{person ? (
									<button
										type="button"
										onClick={() => openComposerWith(habit.id, today, { person })}
										aria-label={`${t("tracker.connection.logWith", { name: person })} · ${item.secondary ?? ""}`}
										className="group flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover"
									>
										{content}
										<Plus
											aria-hidden="true"
											className="mt-0.5 size-4 shrink-0 text-ink-subtle group-hover:text-ink"
										/>
									</button>
								) : editable && item.entryId ? (
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
	const { t } = useT();
	const actions = useActions();
	const store = useAtomicStore();
	const done = block.items.filter((item) => item.done).length;
	// The plan's lines are tasks: checking one off here completes the task, with Undo.
	const toggle = (taskId: string, wasDone: boolean) => {
		const task = store.getState().data.tasks[taskId];
		if (!task || task.deletedAt) {
			toast(t("tracker.plan.taskGone"));
			return;
		}
		actions.toggleTask(taskId);
		if (!wasDone) {
			toast(t("tasks.completed"), {
				action: { label: t("common.undo"), onClick: () => actions.toggleTask(taskId) },
			});
		}
	};
	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-xl bg-sunken/60 p-4 md:p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h3 className="section-label">{block.title}</h3>
				<span className="text-ink-muted text-small tabular-nums">
					{t("tracker.plan.doneOf", {
						count: t.number(done),
						total: t.number(block.items.length),
					})}
				</span>
			</div>
			<ul className="flex flex-col gap-1">
				{block.items.map((item, index) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: plan lines are ordered and may repeat.
						key={index}
						className="flex items-start gap-3"
					>
						{item.taskId && editable ? (
							<button
								type="button"
								// biome-ignore lint/a11y/useSemanticElements: styled like the task checkbox, with full ARIA state.
								role="checkbox"
								aria-checked={item.done}
								aria-label={item.text}
								onClick={() => item.taskId && toggle(item.taskId, item.done)}
								className="-m-[11px] md:-m-[5px] grid size-11 shrink-0 place-items-center rounded-full md:size-8"
							>
								<span
									className={cn(
										"grid size-[22px] place-items-center rounded-full border-[1.5px] transition-colors duration-(--atomic-duration-fast)",
										item.done
											? "border-success bg-success text-surface"
											: "border-line-strong hover:border-ink-subtle",
									)}
								>
									{item.done ? <Check className="size-3.5" strokeWidth={3} /> : null}
								</span>
							</button>
						) : (
							<CircleCheck
								aria-hidden="true"
								className={cn(
									"size-[22px] shrink-0",
									item.done ? "text-success" : "text-ink-subtle",
								)}
							/>
						)}
						<span
							className={cn(
								"min-w-0 break-words pt-px text-body",
								item.done ? "text-ink-muted line-through" : "text-ink",
							)}
						>
							{item.text}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

// ── Photos ────────────────────────────────────────────────────────────────

/** Photos shown before "See all". */
const GALLERY_LIMIT = 12;

const viewerPhoto = (photo: GalleryPhoto): ViewerPhoto => ({
	ref: photo.ref,
	day: photo.day,
	caption: photo.caption,
	entryId: photo.entryId,
});

/** The period's photos, newest first; each opens the viewer on the whole set. */
function GalleryBlock({
	habit,
	block,
}: {
	habit: Habit;
	block: Extract<SummaryBlock, { kind: "gallery" }>;
}) {
	const { t } = useT();
	const openViewer = useTrackerUI((s) => s.openViewer);
	const [expanded, setExpanded] = useState(false);
	const total = block.photos.length;
	const shown = expanded ? block.photos : block.photos.slice(0, GALLERY_LIMIT);
	const open = (index: number) =>
		openViewer({
			mode: "photos",
			habitId: habit.id,
			photos: block.photos.map(viewerPhoto),
			index,
		});
	return (
		<BlockSection
			title={block.title}
			action={
				total > GALLERY_LIMIT ? (
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={expanded}
						onClick={() => setExpanded((v) => !v)}
					>
						{expanded ? t("tracker.showLess") : `${t("common.seeAll")} · ${t.number(total)}`}
					</Button>
				) : null
			}
		>
			<div className="@container">
				<ul className="grid @2xl:grid-cols-6 @md:grid-cols-4 grid-cols-3 gap-1.5">
					{shown.map((photo, index) => {
						const alt = photoAlt(
							photo.ref,
							{ date: photo.day, data: { caption: photo.caption } },
							t,
						);
						const label = `${t("tracker.photo.open", {
							index: t.number(index + 1),
							total: t.number(total),
						})} · ${t.formatDayShort(photo.day)}`;
						return (
							<li key={`${photo.entryId}:${photo.ref.hash}`}>
								<PhotoThumb
									photo={photo.ref}
									alt={alt}
									label={`${label} · ${alt}`}
									caption={t.formatDayShort(photo.day)}
									verbose
									onClick={() => open(index)}
								/>
							</li>
						);
					})}
				</ul>
			</div>
		</BlockSection>
	);
}

/** Then and now (progress photo): the first photo beside the latest, with the days between. */
function CompareBlock({
	habit,
	block,
}: {
	habit: Habit;
	block: Extract<SummaryBlock, { kind: "compare" }>;
}) {
	const { t } = useT();
	const openViewer = useTrackerUI((s) => s.openViewer);
	const days = Math.max(0, diffDays(block.after.day, block.before.day));
	const open = () =>
		openViewer({
			mode: "compare",
			habitId: habit.id,
			before: viewerPhoto(block.before),
			after: viewerPhoto(block.after),
		});
	const pairs = [
		["tracker.photo.then", block.before],
		["tracker.photo.now", block.after],
	] as const;
	return (
		<BlockSection
			title={block.title}
			action={
				<Button variant="ghost" size="sm" onClick={open}>
					<Columns2 />
					{t("tracker.photo.compareAction")}
				</Button>
			}
		>
			<div className="flex flex-col gap-2.5">
				<div className="grid max-w-md grid-cols-2 gap-2.5">
					{pairs.map(([key, photo]) => {
						const day = t.formatDayShort(photo.day);
						const alt = photoAlt(
							photo.ref,
							{ date: photo.day, data: { caption: photo.caption } },
							t,
						);
						return (
							<figure key={key} className="flex min-w-0 flex-col gap-1.5">
								<PhotoThumb
									photo={photo.ref}
									alt={alt}
									label={`${t(key)} · ${day} · ${alt}`}
									variant="full"
									ratio="3 / 4"
									verbose
									onClick={open}
									className="rounded-lg"
								/>
								<figcaption className="text-small">
									<span className="font-semibold text-ink">{t(key)}</span>
									<span className="text-ink-muted"> · {day}</span>
								</figcaption>
							</figure>
						);
					})}
				</div>
				{days > 0 ? (
					<p className="text-ink-muted text-small">{t.tp("tracker.photo.progressDays", days)}</p>
				) : null}
			</div>
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
