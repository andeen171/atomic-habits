import { Timer } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { useTimerState } from "@/lib/timer-store";
import type { TimerState } from "@atomic/core";
import { useHabit, useText, useTimerView } from "@atomic/core/react";
import { router } from "expo-router";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

/**
 * The running session timer on this device (Annex K §5.2, `lib/timer-store.ts`),
 * or null. Today adds the `timer` card when it is set. A timer whose habit
 * is gone doesn't count. Owner: T4.
 */
export function useRunningTimer(): TimerState | null {
	const timer = useTimerState();
	const habit = useHabit(timer?.habitId);
	return timer && habit && !habit.deletedAt ? timer : null;
}

/**
 * Today's "Meditate · 03:12 — Back to timer" card while a timer runs. The
 * clock ticks; paused and time's-up timers say so in words, not only by
 * stopping. Owner: T4.
 */
export function RunningTimerBanner() {
	const t = useT();
	const text = useText();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const timer = useRunningTimer();
	const habit = useHabit(timer?.habitId);
	const view = useTimerView(timer);
	if (!timer || !habit || !view) return null;
	const tone = toneOf(habit.color);
	const name = text.habit(habit, "name");
	const status = view.timeUp
		? t.t("tracker.session.timeUpShort")
		: view.running
			? t.t("tracker.session.running")
			: t.t("tracker.session.paused");
	const line = timer.label ? `${status} · ${timer.label}` : status;
	const open = () => {
		haptics.selection();
		router.push({ pathname: "/habit/timer", params: { id: habit.id } });
	};
	return (
		<Animated.View
			entering={FadeIn}
			exiting={FadeOut}
			layout={LinearTransition}
			style={[styles.card, { backgroundColor: tone.softer, borderColor: colors.border }]}
		>
			<PressableScale
				onPress={open}
				scaleTo={0.98}
				accessibilityRole="button"
				accessibilityLabel={`${name}, ${view.clock}. ${line}. ${t.t("tracker.session.backToTimer")}`}
				style={styles.main}
				testID="running-timer-banner"
			>
				<View style={[styles.tile, { backgroundColor: tone.soft }]}>
					<Text style={styles.emoji} allowFontScaling={false}>
						{habit.emoji}
					</Text>
					<View
						style={[
							styles.badge,
							{
								backgroundColor: view.timeUp ? colors.accent : tone.fill,
								borderColor: colors.surface,
							},
						]}
					>
						<Timer size={11} color={view.timeUp ? colors.onAccent : tone.on} strokeWidth={2.6} />
					</View>
				</View>
				<View style={styles.text}>
					<View style={styles.titleRow}>
						<Text weight="semibold" numberOfLines={1} style={styles.name}>
							{name}
						</Text>
						<Text weight="semibold" tabular>
							{view.clock}
						</Text>
					</View>
					<View style={styles.statusRow}>
						{view.running && !view.timeUp ? (
							<View style={[styles.dot, { backgroundColor: tone.fill }]} />
						) : null}
						<Text variant="small" tone="muted" numberOfLines={1} style={styles.name}>
							{line}
						</Text>
					</View>
				</View>
			</PressableScale>
			<Button
				label={t.t("tracker.session.backToTimer")}
				size="sm"
				onPress={open}
				accessibilityLabel={`${t.t("tracker.session.backToTimer")} · ${name}`}
			/>
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "flex-end",
		gap: 12,
		padding: 14,
		marginBottom: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1,
	},
	main: { flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, flexBasis: 180 },
	tile: {
		width: 44,
		height: 44,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	emoji: { fontSize: 22, lineHeight: 28 },
	badge: {
		position: "absolute",
		right: -4,
		bottom: -4,
		width: 20,
		height: 20,
		borderRadius: 10,
		borderWidth: 2,
		alignItems: "center",
		justifyContent: "center",
	},
	text: { flex: 1, gap: 1 },
	titleRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
	name: { flexShrink: 1 },
	statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
	dot: { width: 6, height: 6, borderRadius: 3 },
}));
