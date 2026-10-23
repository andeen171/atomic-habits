import { PenLine, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type DayKey,
	type Habit,
	type Identity,
	type LogIndex,
	dayVotes,
	isActiveOn,
	journalKindUnavailable,
	logsFor,
} from "@atomic/core";
import { useAtomic, useIdentities, useLogIndex, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";

/**
 * The identity that got the most votes on `day` (ties: the first in the
 * user's order), or null when no identity-linked habit counted a vote.
 * Counts votes the way Today does (`dayVotes`).
 */
function topIdentityOn(
	day: DayKey,
	habits: Readonly<Record<string, Habit>>,
	identities: readonly Identity[],
	index: LogIndex,
): Identity | null {
	const votes = new Map<string, number>();
	for (const habit of Object.values(habits)) {
		if (habit.deletedAt || habit.kind !== "build" || !habit.identityId) continue;
		if (!isActiveOn(habit, day)) continue;
		const count = logsFor(index, habit.id).get(day)?.count ?? 0;
		const cast = dayVotes(habit, day, count);
		if (cast > 0) votes.set(habit.identityId, (votes.get(habit.identityId) ?? 0) + cast);
	}
	let best: Identity | null = null;
	let most = 0;
	for (const identity of identities) {
		const n = votes.get(identity.id) ?? 0;
		if (n > most) {
			best = identity;
			most = n;
		}
	}
	return best;
}

/**
 * "Write down the proof" (Annex J §1.5): evidence for the identity that got
 * the most votes today. With no identity at all evidence can't be written,
 * so the button is left out; when no identity got a vote, the editor asks.
 */
function ProofButton() {
	const t = useT();
	const today = useToday();
	const habits = useAtomic((s) => s.data.habits);
	const identities = useIdentities();
	const index = useLogIndex();
	const identity = useMemo(
		() => topIdentityOn(today, habits, identities, index),
		[today, habits, identities, index],
	);
	const unavailable = journalKindUnavailable("evidence", {
		habits: Object.values(habits),
		identities,
	});
	if (unavailable) return null;
	return (
		<Button
			label={t.t("journal.proof.cta")}
			icon={PenLine}
			variant="secondary"
			size="sm"
			onPress={() => {
				haptics.selection();
				router.push({
					pathname: "/journal/editor",
					params: identity ? { kind: "evidence", identityId: identity.id } : { kind: "evidence" },
				});
			}}
			style={{ alignSelf: "flex-start", marginTop: 10 }}
			testID="perfect-day-proof"
		/>
	);
}

export function PerfectDayCard({ votes }: { votes: number }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	return (
		<Animated.View
			entering={reduceMotion ? undefined : ZoomIn.springify().damping(16)}
			style={styles.card}
			testID="perfect-day-card"
		>
			<View
				style={styles.badge}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			>
				<Sparkles size={18} color={colors.onAccent} strokeWidth={2.2} />
			</View>
			<View style={styles.text}>
				<Text variant="display" color={colors.text} accessibilityRole="header">
					{t.t("today.allDone")}
				</Text>
				<Text variant="small" tone="muted">
					{t.t("today.allDoneBody")}
				</Text>
				{votes > 0 ? (
					<Text variant="small" weight="semibold" tone="accent" style={{ marginTop: 4 }}>
						{t.tp("today.votesToday", votes)}
					</Text>
				) : null}
				<ProofButton />
			</View>
		</Animated.View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		flexDirection: "row",
		gap: 14,
		padding: 18,
		borderRadius: t.radii.xl,
		backgroundColor: t.colors.accentSoft,
		marginBottom: 16,
	},
	badge: {
		width: 38,
		height: 38,
		borderRadius: 19,
		backgroundColor: t.colors.accent,
		alignItems: "center",
		justifyContent: "center",
	},
	text: { flex: 1, minWidth: 0, gap: 4 },
}));
