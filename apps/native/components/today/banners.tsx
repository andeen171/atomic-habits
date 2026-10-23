import { displayHabit } from "@/components/habit/display-habit";
import {
	ArrowRight,
	Check,
	type LucideIcon,
	PenLine,
	RefreshCw,
	Sprout,
	TriangleAlert,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { type AgendaItem, type JournalEntry, recoveryFor, recoveryPlanText } from "@atomic/core";
import { useJournal, useText } from "@atomic/core/react";
import { withAlpha } from "@atomic/core/theme";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

/** A banner item with its comeback plan for the miss that put it here (Annex J §1.5). */
interface Planned {
	item: AgendaItem;
	plan: JournalEntry | undefined;
}

function usePlans(items: readonly AgendaItem[]): Planned[] {
	const journal = useJournal();
	return items.map((item) => ({
		item,
		plan: item.streak.lastMiss
			? recoveryFor(journal, item.habit.id, item.streak.lastMiss)
			: undefined,
	}));
}

/** The editor for an item: its plan, or a new comeback plan for the day it was missed. */
function openPlan({ item, plan }: Planned) {
	haptics.selection();
	if (plan) {
		router.push({ pathname: "/journal/editor", params: { id: plan.id } });
		return;
	}
	const params: Record<string, string> = { kind: "recovery", habitId: item.habit.id };
	if (item.streak.lastMiss) params.date = item.streak.lastMiss;
	router.push({ pathname: "/journal/editor", params });
}

function Banner({
	tone,
	icon: Icon,
	title,
	body,
	children,
	testID,
}: {
	tone: "warning" | "muted";
	icon: LucideIcon;
	title: string;
	body: string;
	children?: ReactNode;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const warning = tone === "warning";
	return (
		<Animated.View
			entering={reduceMotion ? undefined : FadeIn}
			exiting={reduceMotion ? undefined : FadeOut}
			layout={reduceMotion ? undefined : LinearTransition}
			style={[
				styles.card,
				warning
					? { backgroundColor: colors.warningSoft }
					: { backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.border },
			]}
			testID={testID}
		>
			<View
				style={[
					styles.icon,
					{ backgroundColor: warning ? withAlpha(colors.warning, 0.16) : colors.surface },
				]}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			>
				<Icon size={17} color={warning ? colors.warning : colors.success} strokeWidth={2.3} />
			</View>
			<View style={styles.text}>
				<Text weight="semibold" accessibilityRole="header">
					{title}
				</Text>
				<Text variant="small" tone="muted">
					{body}
				</Text>
				{children}
			</View>
		</Animated.View>
	);
}

/**
 * One habit's plan: "Your plan: …" with "Edit plan" once a comeback plan
 * exists for the miss, otherwise the button that writes one (prefilled with
 * the habit and the missed day). `lead` (the habit, when the banner's text
 * doesn't name it) goes above.
 */
function SinglePlan({
	planned,
	action,
	lead,
}: {
	planned: Planned;
	action: string;
	lead?: ReactNode;
}) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const { item, plan } = planned;
	if (!plan) {
		return (
			<View style={styles.single}>
				{lead}
				<Button
					label={action}
					icon={PenLine}
					variant="secondary"
					size="sm"
					onPress={() => openPlan(planned)}
					style={styles.planButton}
					testID={`nmt-plan-${item.habit.id}`}
				/>
			</View>
		);
	}
	// The habit in the content language: "Vou meditar às 07:00…", not "Vou meditate…".
	const line = recoveryPlanText(plan, displayHabit(item.habit, text), t);
	const shown = line ? t.t("journal.nmt.yourPlan", { plan: line }) : t.t("journal.nmt.planSaved");
	return (
		<View style={styles.single}>
			{lead}
			<View style={[styles.planBox, { backgroundColor: withAlpha(colors.surface, 0.8) }]}>
				<View style={styles.planLine}>
					<RefreshCw size={14} color={colors.textMuted} strokeWidth={2.2} style={styles.planIcon} />
					<Text variant="small" style={styles.grow}>
						{shown}
					</Text>
				</View>
				<PressableScale
					onPress={() => openPlan(planned)}
					accessibilityRole="button"
					accessibilityLabel={t.t("journal.nmt.editPlan")}
					accessibilityHint={shown}
					hitSlop={10}
					style={styles.editPlan}
					testID={`nmt-edit-plan-${item.habit.id}`}
				>
					<Text variant="small" weight="semibold" tone="accent">
						{t.t("journal.nmt.editPlan")}
					</Text>
					<ArrowRight size={14} color={colors.accentText} strokeWidth={2.4} />
				</PressableScale>
			</View>
		</View>
	);
}

/**
 * Several habits: each is a chip opening its plan (✓ when one exists) or a
 * new one, under the action ("Plan the comeback").
 */
function PlanChips({ plans, action }: { plans: Planned[]; action: string }) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.chipsBlock}>
			<Text variant="tiny" weight="semibold" tone="muted">
				{action}
			</Text>
			<View style={styles.chips}>
				{plans.map((planned) => {
					const { item, plan } = planned;
					const name = text.habit(item.habit, "name");
					return (
						<PressableScale
							key={item.habit.id}
							onPress={() => openPlan(planned)}
							accessibilityRole="button"
							accessibilityLabel={plan ? `${name}, ${t.t("journal.nmt.planSaved")}` : name}
							accessibilityHint={plan ? t.t("journal.nmt.editPlan") : action}
							hitSlop={4}
							style={[
								styles.chip,
								{
									backgroundColor: withAlpha(colors.surface, 0.85),
									borderColor: plan ? withAlpha(colors.success, 0.45) : colors.border,
								},
							]}
							testID={`nmt-chip-${item.habit.id}`}
						>
							<Text style={styles.chipEmoji} allowFontScaling={false}>
								{item.habit.emoji}
							</Text>
							<Text variant="small" weight="medium" numberOfLines={1} style={styles.chipName}>
								{name}
							</Text>
							{plan ? (
								<Check size={14} color={colors.success} strokeWidth={2.6} />
							) : (
								<PenLine size={13} color={colors.textMuted} strokeWidth={2.2} />
							)}
						</PressableScale>
					);
				})}
			</View>
		</View>
	);
}

/**
 * "Never miss twice": gentle and specific, never guilt. Each habit at risk
 * gets its comeback plan for the miss (Annex J §1.5): the plan itself with
 * "Edit plan", or "Plan the comeback" (several habits: a chip each, ✓ when
 * planned). Owner: T3.
 */
export function NeverMissTwiceBanner({ items }: { items: AgendaItem[] }) {
	const t = useT();
	const text = useText();
	const plans = usePlans(items);
	const first = plans[0];
	if (!first) return null;
	const body =
		plans.length === 1
			? t.t("nmt.body", { habit: text.habit(first.item.habit, "name") })
			: t.tp("nmt.bodyMany", plans.length);
	return (
		<Banner
			tone="warning"
			icon={TriangleAlert}
			title={t.t("nmt.title")}
			body={body}
			testID="nmt-banner"
		>
			{plans.length === 1 ? (
				<SinglePlan planned={first} action={t.t("journal.nmt.plan")} />
			) : (
				<PlanChips plans={plans} action={t.t("journal.nmt.plan")} />
			)}
		</Banner>
	);
}

/**
 * Two misses in a row: begin again. The body is general, so the habit is
 * always named: one habit above "Plan a fresh start" (or its plan), several
 * as chips. Owner: T3.
 */
export function FreshStartBanner({ items }: { items: AgendaItem[] }) {
	const t = useT();
	const text = useText();
	const styles = useStyles();
	const plans = usePlans(items);
	const first = plans[0];
	if (!first) return null;
	const action = t.t("journal.nmt.freshPlan");
	return (
		<Banner
			tone="muted"
			icon={Sprout}
			title={t.t("nmt.freshStart")}
			body={t.t("nmt.freshStartBody")}
			testID="fresh-start-banner"
		>
			{plans.length === 1 ? (
				<SinglePlan
					planned={first}
					action={action}
					lead={
						<View style={styles.lead}>
							<Text style={styles.chipEmoji} allowFontScaling={false}>
								{first.item.habit.emoji}
							</Text>
							<Text variant="small" weight="semibold" style={styles.grow}>
								{text.habit(first.item.habit, "name")}
							</Text>
						</View>
					}
				/>
			) : (
				<PlanChips plans={plans} action={action} />
			)}
		</Banner>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		flexDirection: "row",
		gap: 12,
		padding: 14,
		borderRadius: t.radii.lg,
		marginBottom: 12,
	},
	icon: {
		width: 32,
		height: 32,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center",
		marginTop: 1,
	},
	text: { flex: 1, minWidth: 0, gap: 2 },
	grow: { flex: 1, minWidth: 0 },
	single: { marginTop: 10, gap: 8, alignItems: "flex-start" },
	planButton: { alignSelf: "flex-start" },
	lead: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "stretch" },
	planBox: {
		alignSelf: "stretch",
		borderRadius: t.radii.md,
		paddingHorizontal: 12,
		paddingVertical: 10,
		gap: 6,
	},
	planLine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
	planIcon: { marginTop: 2 },
	editPlan: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-end",
		gap: 4,
		minHeight: 28,
	},
	chipsBlock: { marginTop: 10, gap: 6 },
	chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	chip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		minHeight: 36,
		maxWidth: "100%",
		paddingHorizontal: 11,
		borderRadius: 999,
		borderWidth: 1,
	},
	chipEmoji: { fontSize: 15, lineHeight: 20 },
	chipName: { flexShrink: 1 },
}));
