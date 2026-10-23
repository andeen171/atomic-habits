import { TrendingUp } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { type Habit, type LevelUpSuggestion, levelUpCopy } from "@atomic/core";
import { useActions, useAtomicStore, useLevelUpSuggestion, useText } from "@atomic/core/react";
import { withAlpha } from "@atomic/core/theme";
import { router } from "expo-router";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { displayHabit } from "./display-habit";

export interface LevelUpCardProps {
	habit: Habit;
	/** The suggestion to show; by default the habit's own (`useLevelUpSuggestion`). */
	suggestion?: LevelUpSuggestion | null;
	/** "card": habit detail, with the Goldilocks check-in link. "banner": Today. */
	variant?: "card" | "banner";
	style?: StyleProp<ViewStyle>;
}

/**
 * The Goldilocks rule (D8b, Annex H §1.1.6): after a strong month, offer a
 * slightly higher daily goal (or one more day a week), citing the evidence
 * ("You beat 10 pages on 24 of 30 days in September."). Accept and "Not now"
 * both come with Undo; two dismissals in a row snooze it for a few months.
 */
export function LevelUpCard({
	habit,
	suggestion: given,
	variant = "card",
	style,
}: LevelUpCardProps) {
	const own = useLevelUpSuggestion(given === undefined ? habit : undefined);
	const suggestion = given === undefined ? own : given;
	const t = useT();
	const text = useText();
	const actions = useActions();
	const store = useAtomicStore();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	if (!suggestion) return null;

	// Units in the content language, like the name next to them.
	const copy = levelUpCopy(suggestion, displayHabit(habit, text), t);
	const name = text.habit(habit, "name");
	const banner = variant === "banner";
	const tone = toneOf(habit.color);

	const accept = () => {
		const previous = habit.levelUp ?? null;
		const schedule = habit.schedule;
		if (!actions.acceptLevelUp(habit.id, suggestion)) {
			haptics.warning();
			showToast(t.t("levelUp.stale"));
			return;
		}
		haptics.success();
		showToast(copy.accepted, {
			tone: "success",
			action: {
				label: t.t("common.undo"),
				onPress: () =>
					actions.updateHabit(
						habit.id,
						suggestion.kind === "target"
							? { target: suggestion.from, levelUp: previous }
							: { schedule, levelUp: previous },
					),
			},
		});
	};

	const dismiss = () => {
		const previous = habit.levelUp ?? null;
		actions.dismissLevelUp(habit.id, suggestion.month);
		haptics.selection();
		const after = store.getState().data.habits[habit.id]?.levelUp;
		const snoozed = after?.decision === "dismissed" && (after.dismissals ?? 0) >= 2;
		showToast(t.t(snoozed ? "levelUp.snoozed" : "levelUp.dismissed"), {
			action: {
				label: t.t("common.undo"),
				onPress: () => actions.updateHabit(habit.id, { levelUp: previous }),
			},
		});
	};

	const icon = (
		<View
			style={[
				styles.tile,
				banner ? styles.tileBanner : styles.tileCard,
				{ backgroundColor: tone.soft },
			]}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		>
			<Text
				style={{ fontSize: banner ? 22 : 26, lineHeight: banner ? 28 : 32 }}
				allowFontScaling={false}
			>
				{habit.emoji}
			</Text>
			<View style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.surface }]}>
				<TrendingUp size={11} color={colors.onAccent} strokeWidth={2.6} />
			</View>
		</View>
	);

	const buttons = (
		<View style={styles.buttons}>
			<Button
				label={t.t("levelUp.notNow")}
				variant="ghost"
				size="sm"
				onPress={dismiss}
				testID={`level-up-dismiss-${habit.id}`}
			/>
			<Button
				label={copy.action}
				size="sm"
				icon={TrendingUp}
				onPress={accept}
				testID={`level-up-accept-${habit.id}`}
			/>
		</View>
	);

	return (
		<Animated.View
			entering={FadeIn.duration(220)}
			exiting={FadeOut.duration(160)}
			layout={LinearTransition}
			style={[styles.card, banner ? styles.banner : styles.full, style]}
			testID={`level-up-${variant}`}
		>
			<View style={styles.row}>
				{icon}
				<View style={styles.text}>
					<Text variant="label" tone="muted" numberOfLines={1}>
						{t.t("levelUp.eyebrow")}
					</Text>
					{banner ? (
						<Text weight="semibold" accessibilityRole="header" style={styles.title}>
							{t.t("levelUp.banner", { habit: name })}
						</Text>
					) : (
						<Text variant="display" accessibilityRole="header" style={styles.title}>
							{t.t("levelUp.title")}
						</Text>
					)}
					<Text
						variant="small"
						tone={banner ? "muted" : "default"}
						weight={banner ? "regular" : "medium"}
						style={styles.line}
					>
						{copy.evidence}
					</Text>
					{banner ? null : (
						<Text variant="small" tone="muted" style={styles.line}>
							{copy.why}
						</Text>
					)}
				</View>
			</View>
			{buttons}
			{banner ? null : (
				<Pressable
					onPress={() =>
						router.push({
							pathname: "/journal/editor",
							params: { kind: "checkin", habitId: habit.id },
						})
					}
					hitSlop={8}
					accessibilityRole="link"
					style={styles.checkIn}
				>
					<Text variant="small" weight="semibold" tone="accent">
						{t.t("levelUp.checkIn")}
					</Text>
				</Pressable>
			)}
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		backgroundColor: t.colors.surface,
		borderWidth: 1,
		borderColor: withAlpha(t.colors.accent, t.scheme === "dark" ? 0.35 : 0.28),
		...t.cardShadow,
	},
	banner: { borderRadius: t.radii.lg + 2, padding: 14, marginBottom: 16, gap: 10 },
	full: { borderRadius: t.radii.xl - 2, padding: 18, gap: 14 },
	row: { flexDirection: "row", gap: 12 },
	tile: { alignItems: "center", justifyContent: "center" },
	tileBanner: { width: 44, height: 44, borderRadius: 13 },
	tileCard: { width: 52, height: 52, borderRadius: 15 },
	badge: {
		position: "absolute",
		right: -5,
		bottom: -5,
		width: 20,
		height: 20,
		borderRadius: 10,
		borderWidth: 2,
		alignItems: "center",
		justifyContent: "center",
	},
	text: { flex: 1, minWidth: 0 },
	title: { marginTop: 2 },
	line: { marginTop: 3 },
	buttons: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "flex-end",
		alignItems: "center",
		gap: 8,
	},
	checkIn: { alignSelf: "flex-start", minHeight: 32, justifyContent: "center" },
}));
