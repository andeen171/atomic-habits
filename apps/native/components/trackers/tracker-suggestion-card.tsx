import { Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { type Habit, TRACKERS, type TrackerType, trackerHint, trackerName } from "@atomic/core";
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { deviceStorage } from "./device-storage";
import { trackerUI } from "./tracker-ui";

/** Habits whose suggestion was dismissed on this device (spec §5.8, D34). */
const DISMISSED_KEY = "atomic-habits:tracker-suggestions-dismissed";

const listeners = new Set<() => void>();
const memory = new Set<string>();

function readDismissed(): string {
	return deviceStorage.get(DISMISSED_KEY) ?? "[]";
}

function dismissedIds(raw: string): string[] {
	try {
		const value = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function dismiss(habitId: string): void {
	const ids = dismissedIds(readDismissed()).filter((id) => id !== habitId);
	// The newest 200 are enough; habits come and go.
	if (!deviceStorage.set(DISMISSED_KEY, JSON.stringify([...ids, habitId].slice(-200)))) {
		memory.add(habitId);
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function useDismissed(habitId: string): boolean {
	const raw = useSyncExternalStore(subscribe, readDismissed, readDismissed);
	return memory.has(habitId) || dismissedIds(raw).includes(habitId);
}

/**
 * "Make it interactive" (Annex K §5.1): on a plain habit whose name fits a
 * tracker ("Read 10 pages" → reading log), offer to log it in the app. "Try
 * it" opens the tracker settings prefilled; "Not now" hides it on this
 * device. Owner: T4.
 */
export function TrackerSuggestionCard({ habit, type }: { habit: Habit; type: TrackerType }) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const hidden = useDismissed(habit.id);
	if (hidden || habit.archivedAt) return null;
	const def = TRACKERS[type];
	const tone = toneOf(habit.color);
	return (
		<Animated.View entering={FadeIn.duration(220)} style={styles.card} testID="tracker-suggestion">
			<View style={styles.top}>
				<View style={[styles.tile, { backgroundColor: tone.soft }]}>
					<Text style={styles.emoji} allowFontScaling={false}>
						{def.emoji}
					</Text>
					<View
						style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.surface }]}
					>
						<Sparkles size={11} color={colors.onAccent} strokeWidth={2.6} />
					</View>
				</View>
				<View style={styles.text}>
					<Text variant="label">{t.t("tracker.suggestTitle")}</Text>
					<Text variant="h3" accessibilityRole="header">
						{trackerName(type, t)}
					</Text>
					<Text variant="small" tone="muted">
						{`${trackerHint(type, t)} ${t.t("tracker.suggestBody")}`}
					</Text>
				</View>
			</View>
			<View style={styles.actions}>
				<Button
					label={t.t("tracker.suggestDismiss")}
					variant="ghost"
					size="sm"
					onPress={() => {
						haptics.selection();
						dismiss(habit.id);
					}}
					testID="tracker-suggestion-dismiss"
				/>
				<Button
					label={t.t("tracker.suggestTry")}
					size="sm"
					onPress={() => {
						haptics.light();
						trackerUI.openSettings({ habitId: habit.id, type });
					}}
					testID="tracker-suggestion-try"
				/>
			</View>
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		gap: 14,
		padding: 16,
		marginBottom: 22,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		...t.cardShadow,
	},
	top: { flexDirection: "row", gap: 14 },
	tile: {
		width: 48,
		height: 48,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center",
	},
	emoji: { fontSize: 24, lineHeight: 30 },
	badge: {
		position: "absolute",
		right: -5,
		bottom: -5,
		width: 22,
		height: 22,
		borderRadius: 11,
		borderWidth: 2,
		alignItems: "center",
		justifyContent: "center",
	},
	text: { flex: 1, gap: 2 },
	actions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 },
}));
