import { ArrowRight, ChevronDown, NotebookText, PenLine, Signature } from "@/components/icons";
import { ActionList, type SheetAction } from "@/components/sheet/action-list";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useJournalDismissals } from "@/lib/journal-dismissals";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type CheckinReason,
	type Habit,
	JOURNAL_KIND_SPECS,
	type JournalEntry,
	type JournalKind,
	checkinDismissKey,
	getLog,
	journalKindKey,
	toDayKey,
} from "@atomic/core";
import { useAtomic, useHabitJournal, useText, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { DayNoteSheet, refocus } from "./day-note-card";
import { JournalItemList } from "./journal-timeline";
import { JOURNAL_KIND_ICONS, JournalKindIcon } from "./kind-icon";

export interface HabitJournalSectionProps {
	habit: Habit;
	/**
	 * A level-up card shows on this page: the "strong" Goldilocks check-in
	 * prompt stays hidden (D9).
	 */
	levelUpVisible?: boolean;
}

/**
 * "Journal & notes", the habit page's last section (Annex J §1.5, spec §6
 * item 13). It replaces v1's Notes: the active contract, the Goldilocks
 * check-in prompt ("Not now" lasts the month, on this device), a "Write"
 * sheet prelinked to the habit (plus today's day note), and the habit's 20
 * newest entries and day notes — every v1 note stays listed and opens the
 * note sheet — then "See all in Journal". Renders its own label. Owner: T3.
 */
export function HabitJournalSection({ habit, levelUpVisible }: HabitJournalSectionProps) {
	const t = useT();
	const today = useToday();
	const styles = useStyles();
	const headingRef = useRef<View>(null);
	const { items, total, contract, checkin } = useHabitJournal(habit.id, { levelUpVisible });
	const { dismissed, dismiss } = useJournalDismissals();
	const checkinKey = checkinDismissKey(habit.id, today);
	const showCheckin = checkin && !dismissed.has(checkinKey);

	return (
		<View style={styles.section} testID="habit-journal-section">
			<View style={styles.header}>
				<View ref={headingRef} accessible accessibilityRole="header" style={styles.heading}>
					<Text variant="label">{t.t("journal.habit.title")}</Text>
				</View>
				<WriteButton habit={habit} />
			</View>

			{contract ? <ActiveContract entry={contract} /> : null}

			{showCheckin ? (
				<CheckinPrompt
					habit={habit}
					reason={checkin}
					onDismiss={() => {
						haptics.light();
						dismiss(checkinKey);
						// The prompt (and its focused "Not now") is gone: land on the section.
						setTimeout(() => refocus(headingRef.current), 250);
					}}
				/>
			) : null}

			{items.length ? (
				<JournalItemList items={items} hideHabit impliedIdentityId={habit.identityId} />
			) : (
				<Card tone="sunken" padding={14}>
					<Text variant="small" tone="muted">
						{t.t("journal.habit.empty")}
					</Text>
				</Card>
			)}

			{total > 0 ? (
				<PressableScale
					onPress={() => router.push({ pathname: "/journal", params: { habitId: habit.id } })}
					accessibilityRole="link"
					hitSlop={10}
					style={styles.seeAll}
					testID="habit-journal-see-all"
				>
					<SeeAllLabel label={t.t("journal.habit.seeAll")} />
				</PressableScale>
			) : null}
		</View>
	);
}

function SeeAllLabel({ label }: { label: string }) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.linkRow}>
			<Text variant="small" weight="semibold" tone="accent">
				{label}
			</Text>
			<ArrowRight size={15} color={colors.accentText} strokeWidth={2.2} />
		</View>
	);
}

/** The kinds "Write" offers on a habit's page, in the picker's spirit. */
const WRITE_KINDS: readonly JournalKind[] = ["recovery", "checkin", "contract", "evidence", "note"];

/**
 * "Write": a new entry prelinked to this habit (Annex J §1.5). A check-in
 * needs a habit you're building; comeback plans, check-ins and contracts
 * need one that isn't archived. "Day note · Today" opens today's note.
 */
function WriteButton({ habit }: { habit: Habit }) {
	const t = useT();
	const today = useToday();
	const [menu, setMenu] = useState(false);
	const [note, setNote] = useState(false);
	const hasNote = useAtomic((s) => !!getLog(s, habit.id, today)?.note);
	const archived = habit.archivedAt != null;
	const kinds = WRITE_KINDS.filter((kind) => {
		const need = JOURNAL_KIND_SPECS[kind].habit;
		if (need === "build") return habit.kind === "build" && !archived;
		if (need === "break") return habit.kind === "break" && !archived;
		if (need === "any") return !archived;
		return true;
	});
	const rows: SheetAction[] = [
		...kinds.map((kind) => ({
			key: kind,
			label: t.t(journalKindKey(kind)),
			icon: JOURNAL_KIND_ICONS[JOURNAL_KIND_SPECS[kind].icon],
			onPress: () => {
				setMenu(false);
				router.push({ pathname: "/journal/editor", params: { kind, habitId: habit.id } });
			},
		})),
		{
			key: "dayNote",
			label: hasNote ? t.t("habit.editNote") : t.t("journal.dayNoteShort"),
			hint: t.t("common.today"),
			icon: NotebookText,
			onPress: () => {
				setMenu(false);
				setNote(true);
			},
		},
	];
	return (
		<>
			<Button
				label={t.t("journal.write")}
				icon={PenLine}
				iconRight={ChevronDown}
				variant="secondary"
				size="sm"
				onPress={() => {
					haptics.selection();
					setMenu(true);
				}}
				testID="habit-journal-write"
			/>
			<Sheet
				open={menu}
				onClose={() => setMenu(false)}
				title={t.t("journal.write")}
				testID="habit-journal-write-sheet"
			>
				<ActionList actions={rows} />
			</Sheet>
			<DayNoteSheet
				habit={note ? habit : undefined}
				day={note ? today : null}
				onClose={() => setNote(false)}
			/>
		</>
	);
}

/** "Habit contract · active until Nov 19 · with Ana", the commitment, when it was signed, and Open. */
function ActiveContract({ entry }: { entry: JournalEntry }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const contract = entry.contract;
	if (!contract) return null;
	const until = t.formatDayShort(contract.until);
	const title = contract.partner
		? t.t("journal.habit.contractWith", { date: until, partner: contract.partner })
		: t.t("journal.habit.contract", { date: until });
	const commitment = entry.answers.commitment?.trim();
	const signed = contract.signedAt
		? t.t("journal.contract.signed", { date: t.formatDayShort(toDayKey(contract.signedAt)) })
		: null;
	return (
		<Card padding={14} testID="habit-journal-contract">
			<View style={styles.contractRow}>
				<JournalKindIcon kind="contract" size="sm" />
				<View style={styles.grow}>
					<Text variant="small" weight="semibold">
						{title}
					</Text>
					{commitment ? (
						<Text variant="small" tone="muted" numberOfLines={2}>
							{commitment}
						</Text>
					) : null}
					<View style={styles.contractFooter}>
						{signed ? (
							<View style={[styles.signed, { backgroundColor: colors.successSoft }]}>
								<Signature size={13} color={colors.success} strokeWidth={2.2} />
								<Text variant="tiny" weight="semibold" tone="success">
									{signed}
								</Text>
							</View>
						) : (
							<View />
						)}
						<Button
							label={t.t("journal.open")}
							variant="secondary"
							size="sm"
							accessibilityLabel={`${t.t("journal.open")}: ${title}`}
							onPress={() => router.push({ pathname: "/journal/editor", params: { id: entry.id } })}
						/>
					</View>
				</View>
			</View>
		</Card>
	);
}

/**
 * The Goldilocks check-in prompt (Annex J §1.5, §1.8): "Still the right
 * size?" when the habit is getting automatic, "Is {habit} too hard right
 * now?" when it's slipping. Check in, or Not now (this month, this device).
 */
function CheckinPrompt({
	habit,
	reason,
	onDismiss,
}: {
	habit: Habit;
	reason: CheckinReason;
	onDismiss(): void;
}) {
	const t = useT();
	const text = useText();
	const styles = useStyles();
	const name = text.habit(habit, "name");
	const title = t.t(`journal.checkin.${reason}.title`, { habit: name });
	return (
		<Card tone="accent" padding={16} testID="habit-journal-checkin">
			<View style={styles.contractRow}>
				<JournalKindIcon kind="checkin" size="sm" />
				<View style={styles.grow}>
					<Text variant="h3" accessibilityRole="header">
						{title}
					</Text>
					<Text variant="small" tone="muted">
						{t.t(`journal.checkin.${reason}.body`, { habit: name })}
					</Text>
					<View style={styles.actions}>
						<Button
							label={t.t("journal.checkin.cta")}
							size="sm"
							onPress={() =>
								router.push({
									pathname: "/journal/editor",
									params: { kind: "checkin", habitId: habit.id },
								})
							}
							testID="habit-journal-checkin-cta"
						/>
						<Button
							label={t.t("journal.nudge.dismiss")}
							variant="ghost"
							size="sm"
							accessibilityLabel={t.t("journal.nudge.dismissLabel", { title })}
							onPress={onDismiss}
							testID="habit-journal-checkin-dismiss"
						/>
					</View>
				</View>
			</View>
		</Card>
	);
}

const useStyles = makeStyles(() => ({
	section: { gap: 10, marginBottom: 22 },
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		minHeight: 36,
	},
	heading: { flexShrink: 1 },
	grow: { flex: 1, minWidth: 0, gap: 3 },
	contractRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
	signed: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		gap: 5,
		minHeight: 24,
		paddingHorizontal: 9,
		borderRadius: 999,
	},
	contractFooter: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 8,
		marginTop: 8,
	},
	actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
	seeAll: { alignSelf: "flex-start", paddingVertical: 4 },
	linkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
}));
