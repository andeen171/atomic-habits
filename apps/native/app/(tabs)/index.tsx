import { type AgendaItem, TIMES_OF_DAY, greetingKey } from "@atomic/core";
import { useActions, useAtomic, useDayAgenda, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { ArrowLeft, Check } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { EmptyState } from "@/components/empty-state";
import { HabitRow } from "@/components/habit/habit-row";
import { FreshStartCard, NeverMissTwiceBanner } from "@/components/today/banners";
import { PerfectDayCard } from "@/components/today/perfect-day-card";
import { PrincipleCard } from "@/components/today/principle-card";
import { TodayTasks } from "@/components/today/today-tasks";
import { WeekStrip } from "@/components/today/week-strip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Screen } from "@/components/ui/screen";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { claimCelebration } from "@/lib/prefs";
import { makeStyles, useTheme } from "@/lib/theme";
import { ui } from "@/lib/ui-store";

export default function TodayScreen() {
	const t = useT();
	const styles = useStyles();
	const actions = useActions();
	const today = useToday();
	const [day, setDay] = useState(today);
	const agenda = useDayAgenda(day);
	const name = useAtomic((s) => s.settings.displayName.trim());
	const isToday = day === today;

	// Follow midnight rollover when the user was looking at "today".
	const lastToday = useRef(today);
	useEffect(() => {
		if (lastToday.current !== today) {
			setDay((current) => (current === lastToday.current ? today : current));
			lastToday.current = today;
		}
	}, [today]);

	// One celebration per day, on the transition to "all done".
	const wasAllDone = useRef<boolean | null>(null);
	useEffect(() => {
		if (!agenda.isToday) {
			wasAllDone.current = null;
			return;
		}
		const previous = wasAllDone.current;
		wasAllDone.current = agenda.allDone;
		if (previous === false && agenda.allDone) {
			haptics.success();
			claimCelebration(agenda.day).then((first) => {
				if (first) ui.celebrate();
			});
		}
	}, [agenda.allDone, agenda.isToday, agenda.day]);

	const greeting = t.t(greetingKey(new Date().getHours()));
	const eyebrow = isToday
		? name
			? t.t("greeting.withName", { greeting, name })
			: greeting
		: t.t("today.viewing", { date: t.formatDayShort(day) });
	const title = isToday ? t.t("today.title") : t.formatRelativeDay(day, today);
	const groups = TIMES_OF_DAY.map((time) => ({ time, items: agenda.groups[time] })).filter(
		(g) => g.items.length > 0,
	);
	const nothingDue = !agenda.empty && groups.length === 0 && agenda.score.due === 0;

	if (agenda.empty) {
		return (
			<Screen tab testID="today-screen">
				<Header eyebrow={eyebrow} title={title} />
				<EmptyState
					testID="today-empty"
					title={t.t("today.emptyTitle")}
					body={t.t("today.emptyBody")}
					action={
						<Button
							label={t.t("today.emptyCta")}
							size="lg"
							onPress={() => router.push("/habit/editor")}
							testID="empty-create-habit"
						/>
					}
					secondary={
						<Button
							label={t.t("onboarding.explore")}
							variant="ghost"
							onPress={() => actions.loadDemoData(t.locale)}
						/>
					}
				/>
				<PrincipleCard day={day} />
			</Screen>
		);
	}

	return (
		<Screen tab testID="today-screen">
			<Header
				eyebrow={eyebrow}
				title={title}
				caption={isToday ? t.formatDayLong(day) : null}
				done={agenda.score.done}
				due={agenda.score.due}
				ratio={agenda.score.ratio}
				onBack={isToday ? undefined : () => setDay(today)}
			/>
			<View style={styles.strip}>
				<WeekStrip selected={day} onSelect={setDay} />
			</View>

			{isToday ? (
				<>
					<NeverMissTwiceBanner items={agenda.atRisk} />
					<FreshStartCard items={agenda.broken} />
				</>
			) : null}

			{agenda.allDone ? <PerfectDayCard votes={agenda.votes} /> : null}

			{nothingDue ? (
				<Card tone="sunken" padding={18} style={styles.block}>
					<Text variant="h3">{t.t("today.nothingDue")}</Text>
					<Text variant="small" tone="muted" style={{ marginTop: 4 }}>
						{t.t("today.nothingDueBody")}
					</Text>
				</Card>
			) : null}

			{groups.map((group) => (
				<HabitGroup key={group.time} label={t.t(`time.${group.time}`)} items={group.items} day={day} />
			))}
			{agenda.doneForWeek.length ? (
				<HabitGroup label={t.t("today.doneForWeek")} items={agenda.doneForWeek} day={day} dimmed />
			) : null}
			{agenda.breaking.length ? (
				<HabitGroup label={t.t("today.breaking")} items={agenda.breaking} day={day} />
			) : null}

			<TodayTasks day={day} />
			<PrincipleCard day={day} />
		</Screen>
	);
}

function HabitGroup({
	label,
	items,
	day,
	dimmed,
}: {
	label: string;
	items: AgendaItem[];
	day: string;
	dimmed?: boolean;
}) {
	const styles = useStyles();
	return (
		<Animated.View layout={LinearTransition.springify().damping(20)} entering={FadeIn} style={styles.block}>
			<SectionLabel>{label}</SectionLabel>
			<Card padding={0}>
				{items.map((item, index) => (
					<HabitRow
						key={item.habit.id}
						item={item}
						day={day}
						dimmed={dimmed}
						first={index === 0}
						last={index === items.length - 1}
					/>
				))}
			</Card>
		</Animated.View>
	);
}

function Header({
	eyebrow,
	title,
	caption,
	done,
	due,
	ratio,
	onBack,
}: {
	eyebrow: string;
	title: string;
	caption?: string | null;
	done?: number;
	due?: number;
	ratio?: number;
	onBack?: () => void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const hasScore = due !== undefined && due > 0;
	const allDone = hasScore && done === due;
	return (
		<View style={styles.header}>
			<View style={styles.headerText}>
				<Text variant="small" tone="muted" weight="medium" numberOfLines={1}>
					{eyebrow}
				</Text>
				<Text variant="title" accessibilityRole="header" numberOfLines={2}>
					{title}
				</Text>
				{onBack ? (
					<Pressable
						onPress={() => {
							haptics.selection();
							onBack();
						}}
						hitSlop={10}
						accessibilityRole="button"
						style={styles.back}
						testID="back-to-today"
					>
						<ArrowLeft size={14} color={colors.accent} strokeWidth={2.4} />
						<Text variant="small" weight="semibold" tone="accent">
							{t.t("today.backToToday")}
						</Text>
					</Pressable>
				) : caption ? (
					<Text variant="small" tone="subtle">
						{caption}
					</Text>
				) : null}
			</View>
			{hasScore ? (
				<View
					style={styles.score}
					accessible
					accessibilityLabel={t.t("today.progress", { done: done ?? 0, total: due ?? 0 })}
				>
					<ProgressRing progress={ratio ?? 0} size={62} stroke={5} color={colors.accent} track={colors.sunken}>
						{allDone ? (
							<Check size={24} color={colors.accent} strokeWidth={2.6} />
						) : (
							<Text variant="h3" tabular>
								{t.percent(ratio ?? 0)}
							</Text>
						)}
					</ProgressRing>
					<Text variant="tiny" weight="semibold" tone="muted" tabular>
						{t.t("today.progress", { done: done ?? 0, total: due ?? 0 })}
					</Text>
				</View>
			) : null}
		</View>
	);
}

const useStyles = makeStyles(() => ({
	header: {
		flexDirection: "row",
		alignItems: "flex-start",
		justifyContent: "space-between",
		gap: 12,
		marginBottom: 14,
	},
	headerText: { flex: 1, gap: 2, paddingTop: 4 },
	back: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, alignSelf: "flex-start" },
	score: { alignItems: "center", gap: 6, paddingTop: 4 },
	strip: { marginBottom: 18 },
	block: { marginBottom: 20 },
}));
