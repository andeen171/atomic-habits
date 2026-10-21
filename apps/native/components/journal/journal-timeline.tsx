import { ChevronDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type DayKey,
	type JournalTimelineItem,
	groupTimelineByMonth,
	weekdayOf,
} from "@atomic/core";
import { useToday } from "@atomic/core/react";
import { useMemo, useState } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import Animated, {
	FadeIn,
	FadeOut,
	LayoutAnimationConfig,
	LinearTransition,
} from "react-native-reanimated";
import { DayNoteCard } from "./day-note-card";
import { EntryCard } from "./entry-card";

/** How many items render at first, and per "Show more" (Annex J §5). */
const PAGE = 50;

/** Item motion: rows fade in and out, the rest slide into place; none with reduced motion. */
function useItemMotion() {
	const reduce = useReduceMotion();
	return reduce
		? { entering: undefined, exiting: undefined, layout: undefined }
		: {
				entering: FadeIn.duration(200),
				exiting: FadeOut.duration(140),
				layout: LinearTransition.duration(220),
			};
}

/** One timeline item as a card: an entry or a day note. */
export function TimelineCard({
	item,
	showDate,
	hideHabit,
	hideIdentity,
	flat,
}: {
	item: JournalTimelineItem;
	showDate?: boolean;
	hideHabit?: boolean;
	hideIdentity?: boolean;
	flat?: boolean;
}) {
	return item.type === "entry" ? (
		<EntryCard
			entry={item.entry}
			showDate={showDate}
			hideHabit={hideHabit}
			hideIdentity={hideIdentity}
			flat={flat}
			testID={`journal-card-${item.entry.id}`}
		/>
	) : (
		<DayNoteCard
			log={item.log}
			habit={item.habit}
			showDate={showDate}
			hideHabit={hideHabit}
			testID={`journal-note-${item.log.id}`}
		/>
	);
}

/**
 * The Journal's timeline (Annex J §5): one section per month under a serif
 * heading, the day beside the first item of each day (cards keep the day
 * in their spoken label). A plain list inside the screen's ScrollView, 50
 * items at a time with "Show more"; a new filter remounts it (`key`).
 */
export function JournalTimeline({
	items,
	hideHabit,
	impliedIdentityId,
}: {
	items: readonly JournalTimelineItem[];
	/** Filtered to one habit: cards don't repeat it. */
	hideHabit?: boolean;
	/** Filtered to one identity: cards don't repeat it. */
	impliedIdentityId?: string;
}) {
	const t = useT();
	const styles = useStyles();
	const [limit, setLimit] = useState(PAGE);
	const groups = useMemo(() => groupTimelineByMonth(items.slice(0, limit)), [items, limit]);
	const hidden = items.length - limit;
	return (
		<LayoutAnimationConfig skipEntering>
			<View style={styles.timeline}>
				{groups.map((group) => (
					<MonthSection
						key={group.month}
						month={group.month}
						items={group.items}
						hideHabit={hideHabit}
						impliedIdentityId={impliedIdentityId}
					/>
				))}
				{hidden > 0 ? (
					<Button
						label={t.t("journal.showMore")}
						icon={ChevronDown}
						variant="secondary"
						onPress={() => setLimit((value) => value + PAGE)}
						style={styles.more}
						testID="journal-show-more"
					/>
				) : null}
			</View>
		</LayoutAnimationConfig>
	);
}

function MonthSection({
	month,
	items,
	hideHabit,
	impliedIdentityId,
}: {
	month: string;
	items: JournalTimelineItem[];
	hideHabit?: boolean;
	impliedIdentityId?: string;
}) {
	const t = useT();
	const styles = useStyles();
	const motion = useItemMotion();
	return (
		<View>
			<Text variant="display" accessibilityRole="header" style={styles.month}>
				{t.formatMonth(month)}
			</Text>
			{items.map((item, index) => {
				const firstOfDay = index === 0 || items[index - 1]?.date !== item.date;
				return (
					<Animated.View
						key={item.key}
						{...motion}
						style={[styles.row, index > 0 && (firstOfDay ? styles.newDay : styles.sameDay)]}
					>
						<DayGutter day={item.date} visible={firstOfDay} />
						<View style={styles.grow}>
							<TimelineCard
								item={item}
								showDate={false}
								hideHabit={hideHabit}
								hideIdentity={
									!!impliedIdentityId &&
									item.type === "entry" &&
									item.entry.identityId === impliedIdentityId
								}
							/>
						</View>
					</Animated.View>
				);
			})}
		</View>
	);
}

/** The day beside its first item: "17" over "SAT"; today in the accent. Decorative (cards name the day). */
function DayGutter({ day, visible }: { day: DayKey; visible: boolean }) {
	const t = useT();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const isToday = day === today;
	return (
		<View
			style={styles.gutter}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		>
			{visible ? (
				<>
					<Text
						variant="display"
						tabular
						align="center"
						color={isToday ? colors.accentText : undefined}
						allowFontScaling={false}
						style={styles.dayNumber}
					>
						{String(Number(day.slice(8, 10)))}
					</Text>
					<Text
						variant="label"
						align="center"
						tone={isToday ? "accent" : "muted"}
						allowFontScaling={false}
						numberOfLines={1}
					>
						{t.weekdayName(weekdayOf(day), "short").replace(/\.$/, "")}
					</Text>
				</>
			) : null}
		</View>
	);
}

/**
 * A short list of timeline items with their days on the cards (the habit
 * page's section, the Identity screen's latest entries).
 */
export function JournalItemList({
	items,
	hideHabit,
	impliedIdentityId,
	flat,
	style,
}: {
	items: readonly JournalTimelineItem[];
	/** The habit is implied (the habit page). */
	hideHabit?: boolean;
	/** Entries linked to this identity don't repeat it (the habit's or the identity's own page). */
	impliedIdentityId?: string | null;
	/** Cards inside another card. */
	flat?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const styles = useStyles();
	const motion = useItemMotion();
	return (
		<LayoutAnimationConfig skipEntering>
			<View style={[styles.list, style]}>
				{items.map((item) => (
					<Animated.View key={item.key} {...motion}>
						<TimelineCard
							item={item}
							hideHabit={hideHabit}
							hideIdentity={
								impliedIdentityId !== undefined &&
								item.type === "entry" &&
								item.entry.identityId === impliedIdentityId
							}
							flat={flat}
						/>
					</Animated.View>
				))}
			</View>
		</LayoutAnimationConfig>
	);
}

const useStyles = makeStyles(() => ({
	timeline: { gap: 32 },
	month: { marginBottom: 14 },
	row: { flexDirection: "row", gap: 12 },
	newDay: { paddingTop: 18 },
	sameDay: { paddingTop: 10 },
	grow: { flex: 1, minWidth: 0 },
	gutter: { width: 40, paddingTop: 6, alignItems: "center", gap: 2 },
	dayNumber: { lineHeight: 28 },
	more: { alignSelf: "center" },
	list: { gap: 10 },
}));
