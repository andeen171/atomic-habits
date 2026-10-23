import { ArrowRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useJournalDismissals } from "@/lib/journal-dismissals";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type HabitColor,
	JOURNAL_KIND_SPECS,
	type JournalKind,
	type JournalNudge,
	journalNudgeCopy,
	journalNudgeLink,
	rangeLabel,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useJournalNudge as useCoreJournalNudge,
	useText,
	useToday,
} from "@atomic/core/react";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { refocus } from "./day-note-card";
import { JOURNAL_KIND_ICONS, JournalKindIcon } from "./kind-icon";

/**
 * The one journal nudge for Today (Annex J §1.5): slip and contract nudges
 * are `recoveryNudge` cards, the others `nudge` cards in the Today budget
 * (`planTodayCards`, D35). Null when there is none for `day`, when `day` is
 * not today, or when it was dismissed on this device
 * (`lib/journal-dismissals.ts`). Owner: T3.
 */
export function useJournalNudge(day: DayKey): JournalNudge | null {
	const today = useToday();
	const { dismissed } = useJournalDismissals();
	const nudge = useCoreJournalNudge(dismissed);
	return day === today ? nudge : null;
}

export interface JournalNudgeCardProps {
	nudge: JournalNudge;
}

/** The kind of entry each nudge leads to: its icon and accent. */
const NUDGE_KIND: Record<NonNullable<JournalNudge>["type"], JournalKind> = {
	slip: "recovery",
	contract: "contract",
	review: "review",
	integrity: "integrity",
	evidence: "evidence",
};

/**
 * Set when a card goes away after an answer ("Not now", Kept / Broken): the
 * nudge that takes its place, if one mounts soon after, takes screen-reader
 * focus, so the reader lands on what replaced the button they pressed.
 */
let focusReplacementUntil = 0;

/**
 * A Today card (Annex J §4/§5): "Journal" with the period or day it's about,
 * the title, the body and the call to action (the journal editor, prefilled;
 * a contract opens its entry). The contract card asks "Did you keep it?"
 * with I kept it / I broke it right on the card. "Not now" (spoken "Dismiss:
 * {title}") hides this nudge on this device, with Undo; the next one in line
 * may take its place. It shares the level-up banner's slot and layout.
 * Owner: T3.
 */
export function JournalNudgeCard({ nudge }: JournalNudgeCardProps) {
	// A different nudge is a new card: it fades in (and may take focus).
	return nudge ? <NudgeCard key={nudge.key} nudge={nudge} /> : null;
}

function NudgeCard({ nudge }: { nudge: NonNullable<JournalNudge> }) {
	const t = useT();
	const text = useText();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const actions = useActions();
	const { dismiss, restore } = useJournalDismissals();
	const reduceMotion = useReduceMotion();
	const styles = useStyles();
	const headingRef = useRef<View>(null);

	useEffect(() => {
		if (Date.now() > focusReplacementUntil) return;
		focusReplacementUntil = 0;
		const timer = setTimeout(() => refocus(headingRef.current), 350);
		return () => clearTimeout(timer);
	}, []);

	// Names in the content language (`useText`), like everywhere else on Today.
	const shown: NonNullable<JournalNudge> =
		nudge.type === "slip"
			? { ...nudge, habit: { ...nudge.habit, name: text.habit(nudge.habit, "name") } }
			: nudge.type === "contract" && nudge.habit
				? { ...nudge, habit: { ...nudge.habit, name: text.habit(nudge.habit, "name") } }
				: nudge.type === "evidence"
					? {
							...nudge,
							identity: {
								...nudge.identity,
								statement: text.identity(nudge.identity, "statement"),
							},
						}
					: nudge;
	const copy = journalNudgeCopy(shown, t);
	const link = journalNudgeLink(nudge);
	const contract = nudge.type === "contract" ? nudge.entry : null;

	const detail =
		nudge.type === "slip"
			? t.formatRelativeDay(nudge.day, today)
			: nudge.type === "review"
				? rangeLabel(nudge.range, t, weekStartsOn)
				: nudge.type === "integrity"
					? String(nudge.year)
					: null;

	const leaving = () => {
		focusReplacementUntil = Date.now() + 1500;
	};

	const notNow = () => {
		const key = nudge.key;
		haptics.selection();
		leaving();
		dismiss(key);
		showToast(t.t("journal.nudge.dismissed"), {
			action: { label: t.t("common.undo"), onPress: () => restore(key) },
		});
	};

	const answer = (outcome: "kept" | "broken") => {
		if (!contract) return;
		const id = contract.id;
		if (outcome === "kept") haptics.success();
		else haptics.light();
		leaving();
		actions.setContractOutcome(id, outcome);
		showToast(
			t.t(
				outcome === "kept"
					? "journal.nudge.contract.keptToast"
					: "journal.nudge.contract.brokenToast",
			),
			{
				tone: outcome === "kept" ? "success" : "default",
				action: {
					label: t.t("common.undo"),
					onPress: () => actions.setContractOutcome(id, null),
				},
			},
		);
	};

	const open = () => {
		if ("entryId" in link) {
			router.push({ pathname: "/journal/editor", params: { id: link.entryId } });
			return;
		}
		const params: Record<string, string> = { kind: link.kind };
		if (link.habit) params.habitId = link.habit;
		if (link.date) params.date = link.date;
		if (link.scope) params.scope = link.scope;
		if (link.identity) params.identityId = link.identity;
		router.push({ pathname: "/journal/editor", params });
	};

	const notNowButton = (
		<Button
			label={t.t("journal.nudge.dismiss")}
			accessibilityLabel={t.t("journal.nudge.dismissLabel", { title: copy.title })}
			variant="ghost"
			size="sm"
			onPress={notNow}
			testID="journal-nudge-dismiss"
		/>
	);

	return (
		<Animated.View
			entering={reduceMotion ? undefined : FadeIn.duration(220)}
			exiting={reduceMotion ? undefined : FadeOut.duration(160)}
			layout={reduceMotion ? undefined : LinearTransition}
			style={styles.card}
			testID={`journal-nudge-${nudge.type}`}
		>
			<View style={styles.row}>
				<NudgeIcon nudge={nudge} />
				<View style={styles.text}>
					<Text variant="label" tone="muted" numberOfLines={1}>
						{t.t("nav.journal")}
						{detail ? (
							<Text variant="tiny" weight="semibold" tone="muted" style={styles.detail}>
								{`  ·  ${detail}`}
							</Text>
						) : null}
					</Text>
					<View ref={headingRef} accessible accessibilityRole="header" style={styles.title}>
						<Text weight="semibold">{copy.title}</Text>
					</View>
					<Text variant="small" tone="muted" style={styles.body}>
						{copy.body}
					</Text>
				</View>
			</View>

			{contract ? (
				<>
					{/* The body asks "Did you keep it?"; these answer it. */}
					<View style={styles.answers}>
						<Button
							label={t.t("journal.contract.keptAction")}
							size="sm"
							onPress={() => answer("kept")}
							testID="journal-nudge-kept"
						/>
						<Button
							label={t.t("journal.contract.brokenAction")}
							variant="secondary"
							size="sm"
							onPress={() => answer("broken")}
							testID="journal-nudge-broken"
						/>
					</View>
					<View style={styles.buttons}>
						{notNowButton}
						<Button
							label={copy.cta}
							variant="secondary"
							size="sm"
							onPress={open}
							testID="journal-nudge-open"
						/>
					</View>
				</>
			) : (
				<View style={styles.buttons}>
					{notNowButton}
					<Button
						label={copy.cta}
						iconRight={ArrowRight}
						size="sm"
						onPress={open}
						testID="journal-nudge-cta"
					/>
				</View>
			)}
		</Animated.View>
	);
}

/**
 * The habit (slip, contract) or identity (evidence) the nudge is about, as
 * its emoji tile with the journal kind as a badge, like the level-up banner;
 * reviews and the Integrity Report show the kind's own tile.
 */
function NudgeIcon({ nudge }: { nudge: NonNullable<JournalNudge> }) {
	const styles = useStyles();
	const kind = NUDGE_KIND[nudge.type];
	const habit = nudge.type === "slip" || nudge.type === "contract" ? nudge.habit : undefined;
	const identity = nudge.type === "evidence" ? nudge.identity : undefined;
	if (habit) return <EmojiTile emoji={habit.emoji} color={habit.color} kind={kind} />;
	if (identity) return <EmojiTile emoji={identity.emoji} color={identity.color} kind={kind} />;
	return <JournalKindIcon kind={kind} size="md" style={styles.tile} />;
}

function EmojiTile({
	emoji,
	color,
	kind,
}: { emoji: string; color: HabitColor; kind: JournalKind }) {
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const spec = JOURNAL_KIND_SPECS[kind];
	const tone = toneOf(color);
	const badge = toneOf(spec.color);
	const Icon = JOURNAL_KIND_ICONS[spec.icon];
	return (
		<View
			style={[styles.tile, { backgroundColor: tone.soft }]}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		>
			<Text style={styles.emoji} allowFontScaling={false}>
				{emoji}
			</Text>
			<View style={[styles.badge, { backgroundColor: badge.fill, borderColor: colors.surface }]}>
				<Icon size={11} color={badge.on} strokeWidth={2.6} />
			</View>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	card: {
		backgroundColor: t.colors.surface,
		borderWidth: 1,
		borderColor: t.colors.border,
		borderRadius: t.radii.lg + 2,
		padding: 14,
		marginBottom: 16,
		gap: 10,
		...t.cardShadow,
	},
	row: { flexDirection: "row", gap: 12 },
	tile: {
		width: 44,
		height: 44,
		borderRadius: 13,
		alignItems: "center",
		justifyContent: "center",
	},
	emoji: { fontSize: 22, lineHeight: 28 },
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
	detail: { textTransform: "none", letterSpacing: 0 },
	title: { marginTop: 2 },
	body: { marginTop: 3 },
	answers: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
		paddingLeft: 56,
	},
	buttons: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "flex-end",
		alignItems: "center",
		gap: 8,
	},
}));
