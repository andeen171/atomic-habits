import { ChevronRight } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type Habit,
	JOURNAL_GROUPS,
	JOURNAL_KINDS,
	JOURNAL_KIND_SPECS,
	type JournalKind,
	type MessageKey,
	journalKindHintKey,
	journalKindKey,
	journalKindUnavailable,
} from "@atomic/core";
import { useHabits, useIdentities, useIdentity, useText } from "@atomic/core/react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { JournalKindIcon } from "./kind-icon";

/** Two columns of options from tablet width up. */
function useColumns(): 1 | 2 {
	const { width } = useWindowDimensions();
	return width >= 720 ? 2 : 1;
}

interface OptionCardProps {
	icon: ReactNode;
	title: string;
	/** The kind's or habit's description, or the reason it can't be picked. */
	detail?: string;
	unavailable?: boolean;
	onPick(): void;
	half?: boolean;
	testID?: string;
}

/**
 * A pickable card. One that can't be picked stays reachable (its reason is
 * read as the hint) but only answers with a light warning tap.
 */
function OptionCard({ icon, title, detail, unavailable, onPick, half, testID }: OptionCardProps) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<PressableScale
			testID={testID}
			scaleTo={unavailable ? 1 : 0.98}
			onPress={() => {
				if (unavailable) {
					haptics.warning();
					return;
				}
				haptics.selection();
				onPick();
			}}
			accessibilityRole="button"
			accessibilityLabel={title}
			accessibilityHint={detail}
			accessibilityState={{ disabled: Boolean(unavailable) }}
			style={[styles.card, half && styles.half, unavailable && styles.cardUnavailable]}
		>
			{icon}
			<View style={styles.cardText}>
				<Text weight="semibold" tone={unavailable ? "muted" : "default"}>
					{title}
				</Text>
				{detail ? (
					<Text variant="small" tone={unavailable ? "subtle" : "muted"} italic={unavailable}>
						{detail}
					</Text>
				) : null}
			</View>
			{unavailable ? null : <ChevronRight size={18} color={colors.textSubtle} />}
		</PressableScale>
	);
}

/** The step's big question, in the display serif. */
export function StepHeading({ children }: { children: string }) {
	const styles = useStyles();
	return (
		<Text variant="title" accessibilityRole="header" style={styles.heading}>
			{children}
		</Text>
	);
}

/**
 * "What do you want to write?" (Annex J §5): the nine kinds in their groups
 * (Quick, Plan, Reflect, Free), each a card with its icon, name and the book
 * idea behind it. A kind whose habit or identity requirement can't be met
 * shows the reason instead and can't be picked. Picking calls `onPick`.
 *
 * Cards are buttons rather than radios (as on web): picking moves on to the
 * next step, so a "selected" state would never be heard.
 */
export function JournalKindPicker({ onPick }: { onPick(kind: JournalKind): void }) {
	const t = useT();
	const styles = useStyles();
	const habits = useHabits();
	const identities = useIdentities();
	const columns = useColumns();
	return (
		<View testID="journal-kind-picker">
			<StepHeading>{t.t("journal.pickKind")}</StepHeading>
			{JOURNAL_GROUPS.map((group) => {
				const kinds = JOURNAL_KINDS.filter((kind) => JOURNAL_KIND_SPECS[kind].group === group);
				return (
					<View key={group} style={styles.group}>
						<SectionLabel>{t.t(`journal.group.${group}` as MessageKey)}</SectionLabel>
						<View style={styles.list}>
							{kinds.map((kind) => {
								const reason = journalKindUnavailable(kind, { habits, identities });
								return (
									<OptionCard
										key={kind}
										testID={`journal-kind-${kind}`}
										half={columns === 2}
										unavailable={reason !== null}
										icon={<JournalKindIcon kind={kind} muted={reason !== null} />}
										title={t.t(journalKindKey(kind))}
										detail={reason ? t.t(reason) : t.t(journalKindHintKey(kind))}
										onPick={() => onPick(kind)}
									/>
								);
							})}
						</View>
					</View>
				);
			})}
		</View>
	);
}

function HabitOption({ habit, half, onPick }: { habit: Habit; half: boolean; onPick(): void }) {
	const text = useText();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const identity = useIdentity(habit.identityId);
	return (
		<OptionCard
			testID={`journal-habit-${habit.id}`}
			half={half}
			icon={
				<View style={[styles.emojiTile, { backgroundColor: toneOf(habit.color).soft }]}>
					<Text style={styles.emoji} allowFontScaling={false}>
						{habit.emoji}
					</Text>
				</View>
			}
			title={text.habit(habit, "name")}
			detail={identity && !identity.deletedAt ? text.identity(identity, "statement") : undefined}
			onPick={onPick}
		/>
	);
}

/**
 * "Which habit?" (Annex J §5): the habit step of a kind that needs one
 * (comeback plan, check-in, contract), listing only live, unarchived habits
 * of the right kind. `habits` is that eligible list; empty, `empty` explains
 * what's missing.
 */
export function JournalHabitPicker({
	kind,
	habits,
	onPick,
	empty,
}: {
	kind: JournalKind;
	habits: readonly Habit[];
	onPick(habit: Habit): void;
	/** Shown instead of the list when no habit qualifies. */
	empty: ReactNode;
}) {
	const t = useT();
	const styles = useStyles();
	const columns = useColumns();
	return (
		<View testID="journal-habit-picker">
			<View style={styles.kindLine}>
				<JournalKindIcon kind={kind} size="sm" />
				<Text weight="semibold" tone="muted" style={styles.grow}>
					{t.t(journalKindKey(kind))}
				</Text>
			</View>
			<StepHeading>{t.t("journal.pickHabit")}</StepHeading>
			{habits.length ? (
				<View style={styles.list}>
					{habits.map((habit) => (
						<HabitOption
							key={habit.id}
							habit={habit}
							half={columns === 2}
							onPick={() => onPick(habit)}
						/>
					))}
				</View>
			) : (
				empty
			)}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	heading: { marginBottom: 24 },
	group: { marginBottom: 24 },
	list: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
	card: {
		flexGrow: 1,
		flexBasis: "100%",
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		minHeight: 72,
		paddingVertical: 14,
		paddingHorizontal: 14,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		...t.cardShadow,
	},
	half: { flexBasis: "45%" },
	cardUnavailable: {
		backgroundColor: "transparent",
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		shadowOpacity: 0,
		elevation: 0,
	},
	cardText: { flex: 1, gap: 2 },
	kindLine: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
	grow: { flex: 1 },
	emojiTile: {
		width: 40,
		height: 40,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
	},
	emoji: { fontSize: 20, lineHeight: 26 },
}));
