import {
	Check,
	ChevronRight,
	CircleCheck,
	Columns2,
	ImageOff,
	Info,
	Plus,
	TriangleAlert,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ProgressBar, type ProgressTone } from "@/components/ui/progress-bar";
import { Text, type TextTone } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast, ui } from "@/lib/ui-store";
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
import { motion } from "@atomic/core/theme";
import { type ReactNode, useEffect, useState } from "react";
import { PixelRatio, Pressable, View } from "react-native";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withSequence,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { trackerCaps } from "./caps";
import { PhotoThumb } from "./photo-thumb";
import { Shelf } from "./shelf";
import { TrackerChart } from "./tracker-chart";
import { type ViewerPhoto, openComposerWith, trackerUI } from "./tracker-ui";

/**
 * Renders a tracker summary's blocks (Annex K §3.5, §5.1): stat tiles,
 * charts, breakdowns, the expense budget, lists, notes, the reading shelf
 * and the plan. Everything arrives translated and formatted from core; this
 * only lays it out. Tones never rely on color alone: the text says "over
 * budget", "late"…, and warnings carry an icon. Owner: T4.
 */
export interface SummaryBlocksProps {
	habit: Habit;
	blocks: readonly SummaryBlock[];
	period: Period;
	/** Rows open their entries (off for archived habits). */
	editable: boolean;
}

export function SummaryBlocks({ habit, blocks, period, editable }: SummaryBlocksProps) {
	const styles = useStyles();
	// Today's plan leads: it's what to do now; the stats are how it went.
	// Full-width blocks first (plan, stats, budget, shelf, then and now, the gallery), then charts.
	const isLead = (b: SummaryBlock) =>
		b.kind === "plan" ||
		b.kind === "stats" ||
		b.kind === "progress" ||
		b.kind === "shelf" ||
		b.kind === "compare" ||
		b.kind === "gallery";
	const ordered = [
		...blocks.filter(isLead),
		...blocks.filter((b) => b.kind === "chart"),
		...blocks.filter((b) => !isLead(b) && b.kind !== "chart"),
	];
	return (
		<View style={styles.blocks}>
			{ordered.map((block) => (
				<Block key={block.id} habit={habit} block={block} period={period} editable={editable} />
			))}
		</View>
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
	const { habit: toneOf } = useTheme();
	switch (block.kind) {
		case "stats":
			return <StatsBlock items={block.items} />;
		case "chart":
			return (
				<BlockSection title={block.title}>
					<TrackerChart block={block} color={toneOf(habit.color).fill} />
				</BlockSection>
			);
		case "breakdown":
			return <BreakdownBlock habit={habit} block={block} />;
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
	action,
	children,
}: {
	title: string;
	/** A small button on the title row ("See all", "Compare"). */
	action?: ReactNode;
	children: ReactNode;
}) {
	const styles = useStyles();
	return (
		<View style={styles.section}>
			{action ? (
				<View style={styles.sectionHead}>
					<Text variant="label" accessibilityRole="header" style={styles.grow}>
						{title}
					</Text>
					{action}
				</View>
			) : (
				<Text variant="label" accessibilityRole="header">
					{title}
				</Text>
			)}
			{children}
		</View>
	);
}

/** Text tones for summary tones (AA on surfaces and soft fills). */
export const toneText: Record<Tone, TextTone> = {
	default: "muted",
	good: "success",
	warning: "warning",
	danger: "danger",
};

// ── Stats ─────────────────────────────────────────────────────────────────

const STAT_GAP = 10;

/**
 * Tiles per row by count, so no row ends with a lone tile: on phones two per
 * row, and an odd count lets the first (lead) stat span the row (5 → 1 + 2 +
 * 2); wider, threes for 3 and 6, 3 + 2 for 5, fours otherwise.
 */
function statRows(count: number, width: number): number[] {
	if (count <= 0) return [];
	const rows: number[] = [];
	let left = count;
	if (width >= 520) {
		const per = count === 3 || count === 6 || count === 5 ? 3 : 4;
		while (left > 0) {
			rows.push(Math.min(per, left));
			left -= per;
		}
		return rows;
	}
	if (left % 2 === 1) {
		rows.push(1);
		left -= 1;
	}
	while (left > 0) {
		rows.push(2);
		left -= 2;
	}
	return rows;
}

function StatsBlock({ items }: { items: readonly StatItem[] }) {
	const styles = useStyles();
	const [width, setWidth] = useState(0);
	const rows = statRows(items.length, width);
	let start = 0;
	return (
		<View style={styles.stats} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
			{rows.map((size) => {
				const row = items.slice(start, start + size);
				start += size;
				const tileWidth = width > 0 ? (width - STAT_GAP * (size - 1)) / size : 0;
				// One size per row, so neighbouring values line up.
				const fontSize = Math.min(...row.map((item) => statFontSize(item.value, tileWidth)));
				return (
					<View key={row[0]?.id ?? size} style={styles.statRow}>
						{row.map((item) => (
							<StatTile key={item.id} item={item} fontSize={fontSize} />
						))}
					</View>
				);
			})}
		</View>
	);
}

/**
 * The value's size in a tile this wide: it never breaks mid-number ("R$
 * 442,5|0") or gets cut ("278 push-u…"), 20pt at most and 13 at least
 * (~0.6em per character, with the tile's padding and the font scale).
 */
function statFontSize(value: string, tileWidth: number): number {
	if (tileWidth <= 0) return 20;
	const scale = Math.min(PixelRatio.getFontScale(), 1.6);
	const room = tileWidth - 30;
	return Math.max(13, Math.min(20, Math.floor(room / (Math.max(value.length, 3) * 0.6 * scale))));
}

function StatTile({ item, fontSize }: { item: StatItem; fontSize: number }) {
	const styles = useStyles();
	return (
		<View
			style={styles.stat}
			accessible
			accessibilityLabel={[`${item.label}: ${item.value}`, item.hint].filter(Boolean).join(". ")}
		>
			<Text variant="label" numberOfLines={2}>
				{item.label}
			</Text>
			<Text
				variant="h2"
				weight="semibold"
				tabular
				numberOfLines={1}
				adjustsFontSizeToFit
				minimumFontScale={0.7}
				style={{ fontSize, lineHeight: Math.round(fontSize * 1.3) }}
			>
				{item.value}
			</Text>
			{item.hint ? (
				<Text variant="small" tone={toneText[item.tone ?? "default"]}>
					{item.hint}
				</Text>
			) : null}
		</View>
	);
}

// ── Breakdown ─────────────────────────────────────────────────────────────

function BreakdownBlock({
	habit,
	block,
}: {
	habit: Habit;
	block: Extract<SummaryBlock, { kind: "breakdown" }>;
}) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const fill = toneOf(habit.color).fill;
	const top = Math.max(...block.items.map((item) => item.share), 0.0001);
	return (
		<BlockSection title={block.title}>
			<View style={styles.breakdown}>
				{block.items.map((item) => (
					<View
						key={item.key}
						style={styles.breakdownItem}
						accessible
						accessibilityLabel={`${item.label}: ${item.formatted}, ${t.percent(item.share)}`}
					>
						<View style={styles.breakdownRow}>
							{item.emoji ? (
								<Text style={styles.emoji} allowFontScaling={false}>
									{item.emoji}
								</Text>
							) : null}
							<Text variant="small" numberOfLines={1} style={styles.grow}>
								{item.label}
							</Text>
							<Text variant="small" weight="semibold" tabular>
								{item.formatted}
							</Text>
							<Text variant="tiny" tone="subtle" tabular align="right" style={styles.share}>
								{t.percent(item.share)}
							</Text>
						</View>
						<View style={[styles.track, { backgroundColor: colors.sunken }]}>
							<View
								style={[
									styles.bar,
									{ backgroundColor: fill, width: `${Math.max(2, (item.share / top) * 100)}%` },
								]}
							/>
						</View>
					</View>
				))}
			</View>
		</BlockSection>
	);
}

// ── Progress (the expense budget) ─────────────────────────────────────────

const progressTone: Record<Tone, ProgressTone> = {
	default: "accent",
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
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const thisMonth = useTrackerHeadline(block.id === "budget" ? habit : undefined);
	const parts = (block.caption ?? "").split(" · ").filter(Boolean);
	const current = period.from <= today && today <= period.to;
	// The budget leads with what's left ("R$ 320 left this month"); the pace follows the bar.
	const headline =
		block.id === "budget" ? ((current ? thisMonth : null) ?? parts[0] ?? null) : null;
	const rest = block.id === "budget" ? parts.slice(1) : parts;
	const warn = block.tone === "warning" || block.tone === "danger";
	return (
		<View style={styles.progress} testID={`tracker-progress-${block.id}`}>
			<View style={styles.progressHead}>
				<Text variant="label" accessibilityRole="header">
					{block.title}
				</Text>
				<Text variant="small" tone="muted" tabular>
					{block.formatted}
				</Text>
			</View>
			{headline ? (
				<View style={styles.headline}>
					{block.tone === "danger" ? <TriangleAlert size={20} color={colors.danger} /> : null}
					<Text
						variant="display"
						tone={block.tone === "danger" ? "danger" : "default"}
						style={styles.grow}
					>
						{headline}
					</Text>
				</View>
			) : null}
			<ProgressBar
				value={block.value}
				max={block.max}
				tone={progressTone[block.tone]}
				color={block.tone === "default" ? toneOf(habit.color).fill : undefined}
				accessibilityLabel={block.title}
				valueText={[block.formatted, headline, ...rest].filter(Boolean).join(" · ")}
			/>
			{rest.length ? (
				<View style={styles.caption}>
					{block.tone === "warning" ? (
						<TriangleAlert size={15} color={colors.warning} style={{ marginTop: 2 }} />
					) : null}
					<Text variant="small" tone={toneText[warn ? block.tone : "default"]} style={styles.grow}>
						{rest.join(" · ")}
					</Text>
				</View>
			) : null}
		</View>
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
	const t = useT();
	const today = useToday();
	const store = useAtomicStore();
	const styles = useStyles();
	const edit = (entryId: string) => {
		const entry = store.getState().data.trackerEntries[entryId];
		if (entry && !entry.deletedAt) {
			haptics.selection();
			ui.openEntryComposer({ habitId: habit.id, day: entry.date, entryId });
		}
	};
	// "Your circle": a person's row logs a connection with them (the nudge becomes the action).
	const config = knownTracker(habit);
	const circle = block.id === "circle" && config?.type === "connection" ? config.circle : null;
	const personOf = (id: string) => circle?.[Number(id.slice(id.indexOf(":") + 1))]?.name ?? null;
	return (
		<BlockSection title={block.title}>
			{block.items.length ? (
				<View style={styles.list}>
					{block.items.map((item) => {
						const person = editable && !item.entryId ? personOf(item.id) : null;
						return (
							<ListItemRow
								key={item.id}
								item={item}
								onPress={
									person
										? () => {
												haptics.selection();
												openComposerWith(habit.id, today, { person });
											}
										: editable && item.entryId
											? () => item.entryId && edit(item.entryId)
											: undefined
								}
								add={
									person
										? `${t.t("tracker.connection.logWith", { name: person })}, ${item.secondary ?? ""}`
										: undefined
								}
							/>
						);
					})}
				</View>
			) : block.emptyLabel ? (
				<Text variant="small" tone="subtle">
					{block.emptyLabel}
				</Text>
			) : null}
		</BlockSection>
	);
}

type ListItem = Extract<SummaryBlock, { kind: "list" }>["items"][number];

/**
 * One list row; it opens its entry when it has one (and the habit is
 * editable), or adds one (`add`: what the row does, spoken).
 */
function ListItemRow({
	item,
	onPress,
	add,
}: {
	item: ListItem;
	onPress?: () => void;
	add?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const warn = item.tone === "warning" || item.tone === "danger";
	const label = [item.primary, item.secondary, item.trailing].filter(Boolean).join(", ");
	const content = (
		<>
			{warn ? (
				<TriangleAlert
					size={15}
					color={item.tone === "danger" ? colors.danger : colors.warning}
					style={{ marginTop: 2 }}
				/>
			) : null}
			<View style={styles.grow}>
				<Text
					variant="small"
					tone={item.tone && item.tone !== "default" ? toneText[item.tone] : "default"}
				>
					{item.primary}
				</Text>
				{item.secondary ? (
					<Text variant="tiny" tone="subtle">
						{item.secondary}
					</Text>
				) : null}
			</View>
			{item.trailing ? (
				<Text variant="small" weight="semibold" tabular>
					{item.trailing}
				</Text>
			) : null}
		</>
	);
	if (!onPress) {
		return (
			<View style={styles.listRow} accessible accessibilityLabel={label}>
				{content}
			</View>
		);
	}
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={add ?? label}
			style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.hover }]}
		>
			{content}
			{add ? (
				<Plus size={16} color={colors.textMuted} style={{ marginTop: 1 }} />
			) : (
				<ChevronRight size={16} color={colors.textSubtle} style={{ marginTop: 1 }} />
			)}
		</Pressable>
	);
}

function NoteBlock({ text, tone }: { text: string; tone: Tone }) {
	const { colors } = useTheme();
	const styles = useStyles();
	const warn = tone === "warning" || tone === "danger";
	const Icon = warn ? TriangleAlert : Info;
	const color =
		tone === "danger"
			? colors.danger
			: tone === "warning"
				? colors.warning
				: tone === "good"
					? colors.success
					: colors.textMuted;
	return (
		<View style={styles.note}>
			<Icon size={15} color={color} style={{ marginTop: 2 }} />
			<Text variant="small" tone={toneText[tone]} style={styles.grow}>
				{text}
			</Text>
		</View>
	);
}

function PlanBlock({
	block,
	editable,
}: {
	block: Extract<SummaryBlock, { kind: "plan" }>;
	editable: boolean;
}) {
	const t = useT();
	const actions = useActions();
	const store = useAtomicStore();
	const styles = useStyles();
	const done = block.items.filter((item) => item.done).length;
	// The plan's lines are tasks: checking one off here completes the task, with Undo.
	const toggle = (taskId: string, wasDone: boolean) => {
		const task = store.getState().data.tasks[taskId];
		if (!task || task.deletedAt) {
			haptics.warning();
			showToast(t.t("tracker.plan.taskGone"));
			return;
		}
		actions.toggleTask(taskId);
		if (wasDone) {
			haptics.selection();
			return;
		}
		haptics.light();
		showToast(t.t("tasks.completed"), {
			tone: "success",
			action: { label: t.t("common.undo"), onPress: () => actions.toggleTask(taskId) },
		});
	};
	return (
		<View style={styles.planCard} testID="tracker-plan">
			<View style={styles.planHead}>
				<Text variant="label" accessibilityRole="header">
					{block.title}
				</Text>
				<Text variant="small" tone="muted" tabular>
					{t.t("tracker.plan.doneOf", {
						count: t.number(done),
						total: t.number(block.items.length),
					})}
				</Text>
			</View>
			<View style={styles.plan}>
				{block.items.map((item, index) => (
					<PlanRow
						// biome-ignore lint/suspicious/noArrayIndexKey: plan lines are ordered and may repeat.
						key={index}
						item={item}
						onToggle={
							item.taskId && editable
								? () => item.taskId && toggle(item.taskId, item.done)
								: undefined
						}
					/>
				))}
			</View>
		</View>
	);
}

type PlanLine = Extract<SummaryBlock, { kind: "plan" }>["items"][number];

/** A plan line: a round checkbox bound to its task (like a task row), or a read-only mark. */
function PlanRow({ item, onToggle }: { item: PlanLine; onToggle?: () => void }) {
	const theme = useTheme();
	const { colors } = theme;
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const fill = useSharedValue(item.done ? 1 : 0);
	const pop = useSharedValue(1);
	useEffect(() => {
		fill.value = reduceMotion
			? withTiming(item.done ? 1 : 0, { duration: 1 })
			: withSpring(item.done ? 1 : 0, motion.spring);
	}, [item.done, reduceMotion, fill]);
	const boxStyle = useAnimatedStyle(() => ({
		backgroundColor: fill.value > 0.5 ? colors.success : "transparent",
		borderColor: fill.value > 0.5 ? colors.success : colors.borderStrong,
		transform: [{ scale: pop.value }],
	}));
	const checkStyle = useAnimatedStyle(() => ({
		opacity: fill.value,
		transform: [{ scale: 0.4 + fill.value * 0.6 }],
	}));
	const label = (
		<Text tone={item.done ? "muted" : "default"} style={[styles.grow, item.done && styles.strike]}>
			{item.text}
		</Text>
	);
	if (!onToggle) {
		return (
			<View style={styles.planRow} accessible accessibilityLabel={item.text}>
				{item.done ? (
					<CircleCheck size={24} color={colors.success} />
				) : (
					<View style={[styles.box, { borderColor: colors.borderStrong }]} />
				)}
				{label}
			</View>
		);
	}
	return (
		<Pressable
			onPress={() => {
				if (!reduceMotion)
					pop.value = withSequence(
						withTiming(0.82, { duration: 80 }),
						withSpring(1, motion.spring),
					);
				onToggle();
			}}
			accessibilityRole="checkbox"
			accessibilityState={{ checked: item.done }}
			accessibilityLabel={item.text}
			style={({ pressed }) => [styles.planRow, pressed && { backgroundColor: colors.hover }]}
		>
			<Animated.View style={[styles.box, boxStyle]}>
				<Animated.View style={checkStyle}>
					<Check size={14} color={theme.onStatus.success} strokeWidth={3} />
				</Animated.View>
			</Animated.View>
			{label}
		</Pressable>
	);
}

// ── Photos ────────────────────────────────────────────────────────────────

/** Photos shown before "See all". */
const GALLERY_LIMIT = 12;
const GALLERY_GAP = 6;

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
	const t = useT();
	const styles = useStyles();
	const [expanded, setExpanded] = useState(false);
	const [width, setWidth] = useState(0);
	const total = block.photos.length;
	const shown = expanded ? block.photos : block.photos.slice(0, GALLERY_LIMIT);
	// Three across on phones, more on wider screens; tiles stay at least ~100 pt.
	const columns = width >= 720 ? 6 : width >= 480 ? 4 : 3;
	const tile = width > 0 ? Math.floor((width - GALLERY_GAP * (columns - 1)) / columns) : 0;
	const open = (index: number) => {
		haptics.selection();
		trackerUI.openViewer({
			mode: "photos",
			habitId: habit.id,
			photos: block.photos.map(viewerPhoto),
			index,
		});
	};
	return (
		<BlockSection
			title={block.title}
			action={
				total > GALLERY_LIMIT ? (
					<Button
						label={
							expanded ? t.t("tracker.showLess") : `${t.t("common.seeAll")} · ${t.number(total)}`
						}
						variant="ghost"
						size="sm"
						onPress={() => {
							haptics.selection();
							setExpanded((v) => !v);
						}}
						testID="gallery-toggle"
					/>
				) : null
			}
		>
			<View style={styles.gallery} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
				{tile > 0
					? shown.map((photo, index) => {
							const alt = photoAlt(
								photo.ref,
								{ date: photo.day, data: { caption: photo.caption } },
								t,
							);
							const day = t.formatDayShort(photo.day);
							const label = `${t.t("tracker.photo.open", {
								index: t.number(index + 1),
								total: t.number(total),
							})} · ${day} · ${alt}`;
							return (
								<PhotoThumb
									key={`${photo.entryId}:${photo.ref.hash}`}
									photo={photo.ref}
									alt={alt}
									label={label}
									size={tile}
									caption={day}
									verbose={tile >= 96}
									onPress={() => open(index)}
									testID="gallery-photo"
								/>
							);
						})
					: null}
			</View>
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
	const t = useT();
	const styles = useStyles();
	const days = Math.max(0, diffDays(block.after.day, block.before.day));
	const open = () => {
		haptics.selection();
		trackerUI.openViewer({
			mode: "compare",
			habitId: habit.id,
			before: viewerPhoto(block.before),
			after: viewerPhoto(block.after),
		});
	};
	const pairs = [
		["tracker.photo.then", block.before],
		["tracker.photo.now", block.after],
	] as const;
	return (
		<BlockSection
			title={block.title}
			action={
				<Button
					label={t.t("tracker.photo.compareAction")}
					icon={Columns2}
					variant="ghost"
					size="sm"
					onPress={open}
					testID="compare-open"
				/>
			}
		>
			<View style={styles.compare}>
				<View style={styles.compareRow}>
					{pairs.map(([key, photo]) => {
						const day = t.formatDayShort(photo.day);
						const alt = photoAlt(
							photo.ref,
							{ date: photo.day, data: { caption: photo.caption } },
							t,
						);
						return (
							<View key={key} style={styles.compareItem}>
								<PhotoThumb
									photo={photo.ref}
									alt={alt}
									label={`${t.t(key)} · ${day} · ${alt}`}
									variant="full"
									ratio={3 / 4}
									radius={14}
									verbose
									onPress={open}
									testID="compare-photo"
								/>
								<Text
									variant="small"
									tone="muted"
									numberOfLines={1}
									accessibilityElementsHidden
									importantForAccessibility="no-hide-descendants"
								>
									<Text variant="small" weight="semibold">
										{t.t(key)}
									</Text>
									{` · ${day}`}
								</Text>
							</View>
						);
					})}
				</View>
				{days > 0 ? (
					<Text variant="small" tone="muted">
						{t.tp("tracker.photo.progressDays", days)}
					</Text>
				) : null}
			</View>
		</BlockSection>
	);
}

function PhotosOffBlock({ title }: { title: string }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<BlockSection title={title}>
			<View style={styles.note}>
				<ImageOff size={15} color={colors.textMuted} style={{ marginTop: 2 }} />
				<Text variant="small" tone="muted" style={styles.grow}>
					{t.t("tracker.photosOff")}
				</Text>
			</View>
		</BlockSection>
	);
}

const useStyles = makeStyles((t) => ({
	blocks: { gap: 22 },
	section: { gap: 10 },
	sectionHead: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		minHeight: 36,
		marginVertical: -8,
	},
	gallery: { flexDirection: "row", flexWrap: "wrap", gap: GALLERY_GAP },
	compare: { gap: 10 },
	compareRow: { flexDirection: "row", gap: 10, maxWidth: 440 },
	compareItem: { flex: 1, minWidth: 0, gap: 6 },
	grow: { flex: 1 },
	stats: { gap: STAT_GAP },
	statRow: { flexDirection: "row", gap: STAT_GAP },
	stat: {
		flex: 1,
		minWidth: 0,
		gap: 3,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	breakdown: { gap: 12 },
	breakdownItem: { gap: 5 },
	breakdownRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	share: { width: 38 },
	emoji: { fontSize: 15, lineHeight: 19 },
	track: { height: 6, borderRadius: 3, overflow: "hidden" },
	bar: { height: 6, borderRadius: 3 },
	progress: {
		gap: 10,
		padding: 16,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.sunken,
	},
	progressHead: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "baseline",
		justifyContent: "space-between",
		columnGap: 12,
		rowGap: 2,
	},
	headline: { flexDirection: "row", alignItems: "center", gap: 8 },
	caption: { flexDirection: "row", gap: 6 },
	list: { marginHorizontal: -8 },
	listRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		minHeight: 44,
		paddingHorizontal: 8,
		paddingVertical: 9,
		borderRadius: t.radii.md,
	},
	note: {
		flexDirection: "row",
		gap: 8,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	planCard: {
		gap: 10,
		paddingHorizontal: 16,
		paddingTop: 14,
		paddingBottom: 8,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.sunken,
	},
	planHead: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "baseline",
		justifyContent: "space-between",
		columnGap: 12,
		rowGap: 2,
	},
	plan: { marginHorizontal: -8 },
	planRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 44,
		paddingHorizontal: 8,
		paddingVertical: 6,
		borderRadius: t.radii.md,
	},
	box: {
		width: 24,
		height: 24,
		borderRadius: 12,
		borderWidth: 2,
		alignItems: "center",
		justifyContent: "center",
	},
	strike: { textDecorationLine: "line-through" },
}));
