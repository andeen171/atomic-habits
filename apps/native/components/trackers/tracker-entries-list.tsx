import { Ellipsis, Pencil, Trash2, TriangleAlert } from "@/components/icons";
import { ActionList } from "@/components/sheet/action-list";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast, ui } from "@/lib/ui-store";
import { afterSheet } from "@/lib/use-tracker-actions";
import {
	type DayKey,
	type EntryLine,
	type Habit,
	type TrackerEntry,
	entryAttachments,
} from "@atomic/core";
import {
	useActions,
	useToday,
	useTracker,
	useTrackerEntries,
	useTrackerEntryLines,
} from "@atomic/core/react";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { trackerCaps } from "./caps";
import { PhotoThumb } from "./photo-thumb";
import { toneText } from "./summary-blocks";
import { trackerUI } from "./tracker-ui";

export interface TrackerEntriesListProps {
	habit: Habit;
	/** Entries shown before "See all" expands in place (paginated by month). */
	limit?: number;
}

/**
 * Habit page (spec §6 item 7): the latest entries grouped by day; tap edits,
 * long-press (or "…") opens Edit / Delete with an Undo toast. "See all"
 * expands in place a month at a time. Archived habits list their entries
 * read-only. Renders its own section label and spacing; nothing for plain
 * habits. Owner: T4.
 */
export function TrackerEntriesList({ habit, limit = 5 }: TrackerEntriesListProps) {
	const t = useT();
	const styles = useStyles();
	const tracker = useTracker(habit);
	const all = useTrackerEntries(tracker ? habit.id : undefined);
	const entries = useMemo(() => all.filter((entry) => entry.type !== "book"), [all]);
	const [expanded, setExpanded] = useState(false);
	const [months, setMonths] = useState(1);
	const monthKeys = useMemo(() => [...new Set(entries.map((e) => e.date.slice(0, 7)))], [entries]);
	if (!tracker || entries.length === 0) return null;

	const editable = tracker.active && !habit.archivedAt;
	const shownMonths = monthKeys.slice(0, months);
	const shown = expanded
		? entries.filter((e) => shownMonths.includes(e.date.slice(0, 7)))
		: entries.slice(0, limit);

	return (
		<View style={styles.block} testID="tracker-entries">
			<SectionLabel
				right={
					entries.length > limit ? (
						<Button
							label={
								expanded
									? t.t("tracker.showLess")
									: `${t.t("common.seeAll")} · ${t.number(entries.length)}`
							}
							variant="ghost"
							size="sm"
							onPress={() => {
								haptics.selection();
								setExpanded((v) => !v);
								setMonths(1);
							}}
							accessibilityHint={undefined}
							testID="tracker-entries-toggle"
						/>
					) : undefined
				}
			>
				{t.t("tracker.entries")}
			</SectionLabel>
			<View style={styles.card}>
				{expanded ? (
					shownMonths.map((month) => (
						<View key={month}>
							<Text variant="label" style={styles.month} accessibilityRole="header">
								{t.formatMonth(month)}
							</Text>
							<DayGroups
								habit={habit}
								entries={shown.filter((e) => e.date.startsWith(month))}
								editable={editable}
							/>
						</View>
					))
				) : (
					<DayGroups habit={habit} entries={shown} editable={editable} />
				)}
				{expanded && months < monthKeys.length ? (
					<Button
						label={t.t("tracker.showEarlier")}
						variant="secondary"
						size="sm"
						onPress={() => setMonths((n) => n + 1)}
						style={styles.earlier}
					/>
				) : null}
			</View>
		</View>
	);
}

function DayGroups({
	habit,
	entries,
	editable,
}: {
	habit: Habit;
	entries: readonly TrackerEntry[];
	editable: boolean;
}) {
	const t = useT();
	const styles = useStyles();
	const today = useToday();
	const lines = useTrackerEntryLines(habit, entries);
	const groups = useMemo(() => {
		const out: { day: DayKey; items: { entry: TrackerEntry; line: EntryLine }[] }[] = [];
		for (const item of lines) {
			const last = out[out.length - 1];
			if (last && last.day === item.entry.date) last.items.push(item);
			else out.push({ day: item.entry.date, items: [item] });
		}
		return out;
	}, [lines]);
	return (
		<View>
			{groups.map((group) => (
				<View key={group.day} style={styles.group}>
					<Text variant="tiny" weight="semibold" tone="muted" style={styles.dayLabel}>
						{t.formatRelativeDay(group.day, today)}
					</Text>
					<EntryRows habit={habit} items={group.items} editable={editable} />
				</View>
			))}
		</View>
	);
}

/**
 * Entry rows with their Edit / Delete sheet; shared with the day entries
 * sheet. `onOpen` runs before the composer opens (the day sheet closes
 * first).
 */
export function EntryRows({
	habit,
	items,
	editable,
	onOpen,
}: {
	habit: Habit;
	items: readonly { entry: TrackerEntry; line: EntryLine }[];
	editable: boolean;
	onOpen?(): void;
}) {
	const t = useT();
	const actions = useActions();
	const tracker = useTracker(habit);
	const [menu, setMenu] = useState<{ entry: TrackerEntry; line: EntryLine } | null>(null);
	const [lastMenu, setLastMenu] = useState(menu);
	// Entries of unknown types (a newer version) or of a previous tracker stay read-only.
	const own = (entry: TrackerEntry) =>
		!!tracker && tracker.def.entryTypes.includes(entry.type as never);
	const edit = (entry: TrackerEntry) => {
		haptics.selection();
		const open = () =>
			ui.openEntryComposer({ habitId: habit.id, day: entry.date, entryId: entry.id });
		if (onOpen) {
			onOpen();
			afterSheet(open);
		} else open();
	};
	const remove = (entry: TrackerEntry) => {
		actions.deleteTrackerEntry(entry.id);
		haptics.medium();
		showToast(t.t("tracker.entryDeleted"), {
			action: { label: t.t("common.undo"), onPress: () => actions.restoreTrackerEntry(entry.id) },
		});
	};
	const openMenu = (item: { entry: TrackerEntry; line: EntryLine }) => {
		haptics.medium();
		setLastMenu(item);
		setMenu(item);
	};
	const shownMenu = menu ?? lastMenu;
	return (
		<View>
			{items.map((item) => (
				<EntryRow
					key={item.entry.id}
					habitId={habit.id}
					entry={item.entry}
					onOpen={onOpen}
					line={item.line}
					editable={editable && own(item.entry)}
					onEdit={() => edit(item.entry)}
					onMenu={() => openMenu(item)}
					onDelete={() => remove(item.entry)}
				/>
			))}
			<Sheet
				open={menu !== null}
				onClose={() => setMenu(null)}
				title={shownMenu?.line.primary}
				subtitle={shownMenu?.line.secondary ?? undefined}
			>
				<ActionList
					actions={[
						{
							key: "edit",
							label: t.t("common.edit"),
							icon: Pencil,
							onPress: () => {
								const item = menu;
								setMenu(null);
								if (item) afterSheet(() => edit(item.entry));
							},
						},
						{
							key: "delete",
							label: t.t("common.delete"),
							icon: Trash2,
							tone: "danger",
							onPress: () => {
								const item = menu;
								setMenu(null);
								if (item) remove(item.entry);
							},
						},
					]}
				/>
			</Sheet>
		</View>
	);
}

function EntryRow({
	habitId,
	entry,
	onOpen,
	line,
	editable,
	onEdit,
	onMenu,
	onDelete,
}: {
	habitId: string;
	entry: TrackerEntry;
	/** Runs before the viewer opens (the day sheet closes first). */
	onOpen?(): void;
	line: EntryLine;
	editable: boolean;
	onEdit(): void;
	onMenu(): void;
	onDelete(): void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const warn = line.tone === "warning" || line.tone === "danger";
	const label = [line.time, line.primary, line.secondary].filter(Boolean).join(", ");
	const body = (
		<>
			<Text variant="tiny" tone="subtle" tabular style={styles.time}>
				{line.time ?? ""}
			</Text>
			<View style={styles.grow}>
				<View style={styles.primary}>
					{warn ? (
						<TriangleAlert
							size={14}
							color={line.tone === "danger" ? colors.danger : colors.warning}
						/>
					) : null}
					<Text
						variant="small"
						weight="semibold"
						tone={warn ? toneText[line.tone] : "default"}
						style={styles.grow}
					>
						{line.primary}
					</Text>
				</View>
				{line.secondary ? (
					<Text variant="small" tone="muted">
						{line.secondary}
					</Text>
				) : null}
			</View>
		</>
	);
	const photos = <EntryPhotos habitId={habitId} entry={entry} onOpen={onOpen} />;
	if (!editable) {
		return (
			<View style={styles.rowWrap}>
				<View style={[styles.row, styles.grow]} accessible accessibilityLabel={label}>
					{body}
				</View>
				{photos}
			</View>
		);
	}
	return (
		<View style={styles.rowWrap}>
			<Pressable
				onPress={onEdit}
				onLongPress={onMenu}
				delayLongPress={350}
				accessibilityRole="button"
				accessibilityLabel={label}
				accessibilityHint={t.t("tracker.editEntry")}
				accessibilityActions={[
					{ name: "activate", label: t.t("common.edit") },
					{ name: "delete", label: t.t("common.delete") },
				]}
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === "delete") onDelete();
					else onEdit();
				}}
				style={({ pressed }) => [
					styles.row,
					styles.grow,
					pressed && { backgroundColor: colors.hover },
				]}
			>
				{body}
			</Pressable>
			{photos}
			<IconButton
				icon={Ellipsis}
				size={32}
				iconSize={18}
				color={colors.textMuted}
				accessibilityLabel={t.t("tracker.entryActions", { entry: line.primary })}
				onPress={onMenu}
			/>
		</View>
	);
}

/**
 * Up to three of an entry's photos, stacked; opens the viewer on them. Not
 * where photos are off (the entry line already says "2 photos").
 */
function EntryPhotos({
	habitId,
	entry,
	onOpen,
}: {
	habitId: string;
	entry: TrackerEntry;
	onOpen?(): void;
}) {
	const t = useT();
	const styles = useStyles();
	const photos = entryAttachments(entry);
	if (photos.length === 0 || !trackerCaps().photos) return null;
	const caption = typeof entry.data.caption === "string" ? entry.data.caption : null;
	const shown = photos.slice(0, 3);
	return (
		<PressableScale
			onPress={() => {
				haptics.selection();
				onOpen?.();
				trackerUI.openViewer({
					mode: "photos",
					habitId,
					index: 0,
					photos: photos.map((ref) => ({ ref, day: entry.date, caption, entryId: entry.id })),
				});
			}}
			scaleTo={0.95}
			hitSlop={4}
			accessibilityRole="imagebutton"
			accessibilityLabel={t.t("tracker.photo.open", {
				index: t.number(1),
				total: t.number(photos.length),
			})}
			style={styles.photos}
			testID="entry-photos"
		>
			{shown.map((ref, i) => (
				<PhotoThumb
					key={ref.hash}
					photo={ref}
					alt=""
					size={38}
					radius={9}
					decorative
					bare={i > 0}
					style={[styles.stackThumb, i > 0 && styles.stacked, { zIndex: 3 - i }]}
				/>
			))}
		</PressableScale>
	);
}

const useStyles = makeStyles((t) => ({
	block: { marginBottom: 22 },
	card: {
		paddingHorizontal: 8,
		paddingVertical: 6,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		...t.cardShadow,
	},
	month: { paddingHorizontal: 8, paddingTop: 12, paddingBottom: 2 },
	group: { paddingTop: 8 },
	dayLabel: { paddingHorizontal: 8, paddingBottom: 2 },
	rowWrap: { flexDirection: "row", alignItems: "center" },
	row: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 8,
		minHeight: 48,
		paddingHorizontal: 8,
		paddingVertical: 9,
		borderRadius: t.radii.md,
	},
	time: { width: 40, paddingTop: 2 },
	grow: { flex: 1 },
	primary: { flexDirection: "row", alignItems: "center", gap: 6 },
	earlier: { alignSelf: "flex-start", margin: 8 },
	photos: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4, minHeight: 44 },
	stackThumb: { borderWidth: 2, borderColor: t.colors.surface },
	stacked: { marginLeft: -14 },
}));
