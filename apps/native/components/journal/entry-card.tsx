import {
	CalendarRange,
	Ellipsis,
	Info,
	type LucideIcon,
	Pin,
	PinOff,
	Trash2,
} from "@/components/icons";
import { ActionList } from "@/components/sheet/action-list";
import { Sheet } from "@/components/sheet/sheet";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { type AppTranslator, useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type JournalEntry,
	type MessageKey,
	type Translator,
	type Weekday,
	addDays,
	checkJournalEntry,
	contractStatus,
	displayKind,
	isJournalKind,
	journalKindKey,
	journalLinkLabel,
	journalPreview,
	rangeLabel,
	reviewScopeOf,
} from "@atomic/core";
import { useActions, useAtomic, useText, useToday } from "@atomic/core/react";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { AccessibilityInfo, type StyleProp, View, type ViewStyle } from "react-native";
import { ContractStatusBadge, DIFFICULTY_ICON, RatingDisc } from "./journal-blocks";
import { JournalKindIcon } from "./kind-icon";

/** "Today", "Yesterday", "Oct 17"; another year adds it ("Oct 17, 2025" / "17 de out de 2025"). */
export function journalDayLabel(day: DayKey, today: DayKey, t: Translator): string {
	if (day === today) return t.t("common.today");
	if (day === addDays(today, -1)) return t.t("common.yesterday");
	const short = t.formatDayShort(day);
	const year = day.slice(0, 4);
	if (year === today.slice(0, 4)) return short;
	return t.locale === "pt-BR" ? `${short} de ${year}` : `${short}, ${year}`;
}

/** The card's title: the kind ("Evidence"), or the review's period kind ("Weekly review"). */
export function journalEntryTitle(
	entry: JournalEntry,
	t: Translator,
	weekStartsOn: Weekday,
): string {
	if (entry.kind === "review" && entry.range) {
		const scope = reviewScopeOf(entry.range, weekStartsOn);
		if (scope) return t.t(`journal.review.scope.${scope}` as MessageKey);
	}
	return t.t(journalKindKey(entry.kind));
}

/** `journal.card.label` without a dangling colon when there's no text. */
export function journalCardLabel(t: Translator, kind: string, date: string, preview: string) {
	return preview ? t.t("journal.card.label", { kind, date, preview }) : `${kind}, ${date}`;
}

/** Opens an entry in the editor. */
export function openJournalEntry(id: string): void {
	router.push({ pathname: "/journal/editor", params: { id } });
}

/** A small pill on a card: link chips (identity, habit) and status badges, always in words. */
export function CardPill({
	children,
	leading,
	icon: Icon,
	muted,
	dashed,
}: {
	children: string;
	leading?: ReactNode;
	icon?: LucideIcon;
	/** A deleted identity or habit. */
	muted?: boolean;
	/** "Unfinished": an outline instead of a fill. */
	dashed?: boolean;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={[styles.pill, dashed && styles.pillDashed]}>
			{leading}
			{Icon ? <Icon size={12} color={colors.textMuted} strokeWidth={2.1} /> : null}
			<Text
				variant="tiny"
				weight="medium"
				tone={muted ? "subtle" : "muted"}
				italic={muted}
				numberOfLines={1}
				style={styles.pillText}
			>
				{children}
			</Text>
		</View>
	);
}

function PillEmoji({ children }: { children: string }) {
	return (
		<Text style={{ fontSize: 12, lineHeight: 16 }} allowFontScaling={false}>
			{children}
		</Text>
	);
}

export interface EntryCardProps {
	entry: JournalEntry;
	/** Show the day on the card (the timeline shows it in its gutter instead). */
	showDate?: boolean;
	/** The habit is implied (the habit page's section). */
	hideHabit?: boolean;
	/** The identity is implied (an identity's own list). */
	hideIdentity?: boolean;
	/** Lines of preview text (default 2). */
	lines?: 1 | 2 | 3;
	/** No shadow, a quieter border: a card listed inside another card. */
	flat?: boolean;
	/** The pin mark beside the title (off in the pinned strip, where every card is pinned). */
	showPin?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/**
 * A journal entry in a list (Annex J §4–§5): the kind's icon and name, the
 * day, the first answer as a preview, the identity and habit it's linked to
 * (muted with "(deleted)" once gone) and badges in words — Unfinished, the
 * contract's status, the check-in's difficulty, the rating, the review's
 * period, "newer version". A tap opens the entry; long-press or "…" opens
 * Pin / Delete (with Undo), also offered to screen readers as actions.
 */
export function EntryCard({
	entry,
	showDate = true,
	hideHabit = false,
	hideIdentity = false,
	lines = 2,
	flat = false,
	showPin = true,
	style,
	testID,
}: EntryCardProps) {
	const t = useT();
	const text = useText();
	const actions = useActions();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const habits = useAtomic((s) => s.data.habits);
	const identities = useAtomic((s) => s.data.identities);
	const [menu, setMenu] = useState(false);

	const kind = displayKind(entry.kind);
	const known = isJournalKind(entry.kind);
	const identity = entry.identityId ? identities[entry.identityId] : undefined;
	const habit = entry.habitId ? habits[entry.habitId] : undefined;
	const identityLink = hideIdentity
		? null
		: journalLinkLabel("identity", entry.identityId, identities, t);
	const habitLink = hideHabit ? null : journalLinkLabel("habit", entry.habitId, habits, t);
	const title = journalEntryTitle(entry, t, weekStartsOn);
	const date = journalDayLabel(entry.date, today, t);
	const preview = journalPreview(entry, 280);
	const unfinished = known && !checkJournalEntry(entry, habits).complete;
	const status = kind === "contract" && entry.contract ? contractStatus(entry, today) : null;
	const accent =
		kind === "evidence" && identity && !identity.deletedAt ? identity.color : undefined;
	const identityText =
		identity && identityLink && !identityLink.deleted
			? text.identity(identity, "statement")
			: identityLink?.text;
	const habitText =
		habit && habitLink && !habitLink.deleted ? text.habit(habit, "name") : habitLink?.text;

	// Pills, and the same facts in words for screen readers (read after the label, as a hint).
	const pills: ReactNode[] = [];
	const meta: string[] = [];
	if (entry.pinned) meta.push(t.t("journal.pinned"));
	if (identityLink && identityText) {
		meta.push(identityText);
		pills.push(
			<CardPill
				key="identity"
				muted={identityLink.deleted}
				leading={identity && !identityLink.deleted ? <PillEmoji>{identity.emoji}</PillEmoji> : null}
			>
				{identityText}
			</CardPill>,
		);
	}
	if (habitLink && habitText) {
		meta.push(habitText);
		pills.push(
			<CardPill
				key="habit"
				muted={habitLink.deleted}
				leading={habit && !habitLink.deleted ? <PillEmoji>{habit.emoji}</PillEmoji> : null}
			>
				{habitText}
			</CardPill>,
		);
	}
	if (status && entry.contract) {
		meta.push(
			status === "active"
				? t.t("journal.contract.active", { date: t.formatDayShort(entry.contract.until) })
				: t.t(`journal.contract.${status}` as MessageKey),
		);
		pills.push(
			<ContractStatusBadge key="status" status={status} until={entry.contract.until} size="sm" />,
		);
	}
	if (kind === "checkin" && entry.difficulty) {
		const label = t.t(`journal.difficulty.${entry.difficulty}`);
		meta.push(label);
		pills.push(
			<CardPill key="difficulty" icon={DIFFICULTY_ICON[entry.difficulty]}>
				{label}
			</CardPill>,
		);
	}
	if (kind === "awareness" && entry.rating) {
		const label = t.t(`journal.rating.${entry.rating}`);
		meta.push(label);
		pills.push(
			<CardPill key="rating" leading={<RatingDisc rating={entry.rating} size={16} />}>
				{label}
			</CardPill>,
		);
	}
	if (kind === "review" && entry.range) {
		const label = rangeLabel(entry.range, t, weekStartsOn);
		meta.push(label);
		pills.push(
			<CardPill key="range" icon={CalendarRange}>
				{label}
			</CardPill>,
		);
	}
	if (!known) {
		// A kind from a newer Atomic: shown as a note, read-only here (Annex J §1.1).
		meta.push(t.t("journal.newerVersion"));
		pills.push(
			<CardPill key="newer" icon={Info}>
				{t.t("journal.newerVersion")}
			</CardPill>,
		);
	}
	if (unfinished) {
		meta.push(t.t("journal.unfinished"));
		pills.push(
			<CardPill key="unfinished" dashed>
				{t.t("journal.unfinished")}
			</CardPill>,
		);
	}

	const togglePin = () => {
		haptics.selection();
		actions.updateJournalEntry(entry.id, { pinned: !entry.pinned });
		AccessibilityInfo.announceForAccessibility(
			entry.pinned ? t.t("journal.unpin") : t.t("journal.pinned"),
		);
	};
	const remove = () => removeJournalEntry(entry.id, actions, t);

	return (
		<View style={[styles.card, flat ? styles.flat : styles.raised, style]} testID={testID}>
			<PressableScale
				scaleTo={0.985}
				onPress={() => openJournalEntry(entry.id)}
				onLongPress={() => {
					haptics.medium();
					setMenu(true);
				}}
				delayLongPress={350}
				accessibilityRole="button"
				accessibilityLabel={journalCardLabel(t, title, date, preview)}
				accessibilityHint={meta.length ? meta.join(". ") : undefined}
				accessibilityActions={[
					{ name: "pin", label: entry.pinned ? t.t("journal.unpin") : t.t("journal.pin") },
					{ name: "delete", label: t.t("journal.delete") },
				]}
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === "pin") togglePin();
					if (event.nativeEvent.actionName === "delete") remove();
				}}
				style={styles.press}
			>
				<View style={styles.titleRow}>
					<JournalKindIcon kind={entry.kind} color={accent} size="xs" />
					<Text variant="small" weight="semibold" style={styles.title}>
						{title}
					</Text>
					{showDate ? (
						<Text variant="small" tone="muted">
							{date}
						</Text>
					) : null}
					{entry.pinned && showPin ? (
						<Pin size={13} color={colors.textSubtle} strokeWidth={2} />
					) : null}
				</View>
				{preview ? (
					<Text numberOfLines={lines} style={styles.preview}>
						{preview}
					</Text>
				) : null}
				{pills.length ? <View style={styles.pills}>{pills}</View> : null}
			</PressableScale>
			<IconButton
				icon={Ellipsis}
				size={34}
				iconSize={18}
				color={colors.textMuted}
				accessibilityLabel={t.x("a11y.habitActions", { habit: `${title}, ${date}` })}
				onPress={() => setMenu(true)}
				style={styles.more}
				testID={testID ? `${testID}-more` : undefined}
			/>
			<Sheet open={menu} onClose={() => setMenu(false)} title={title} subtitle={date}>
				<ActionList
					actions={[
						{
							key: "pin",
							label: entry.pinned ? t.t("journal.unpin") : t.t("journal.pin"),
							icon: entry.pinned ? PinOff : Pin,
							onPress: () => {
								setMenu(false);
								togglePin();
							},
						},
						{
							key: "delete",
							label: t.t("journal.delete"),
							icon: Trash2,
							tone: "danger",
							onPress: () => {
								setMenu(false);
								remove();
							},
						},
					]}
				/>
			</Sheet>
		</View>
	);
}

/** Deletes an entry (a tombstone) with an Undo toast (Annex J §1.3). */
export function removeJournalEntry(
	id: string,
	actions: ReturnType<typeof useActions>,
	t: AppTranslator,
): void {
	haptics.light();
	actions.deleteJournalEntry(id);
	showToast(t.t("journal.deleted"), {
		action: { label: t.t("common.undo"), onPress: () => actions.restoreJournalEntry(id) },
	});
}

const useStyles = makeStyles((t) => ({
	card: {
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
	},
	raised: t.cardShadow,
	flat: {},
	press: { paddingVertical: 12, paddingLeft: 14, paddingRight: 44, gap: 4 },
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		flexWrap: "wrap",
		columnGap: 8,
		rowGap: 2,
		minHeight: 26,
	},
	title: { flexShrink: 1 },
	preview: { marginTop: 2 },
	pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
	pill: {
		flexDirection: "row",
		alignItems: "center",
		gap: 5,
		minHeight: 24,
		maxWidth: "100%",
		paddingHorizontal: 9,
		paddingVertical: 3,
		borderRadius: 999,
		backgroundColor: t.colors.sunken,
	},
	pillDashed: {
		backgroundColor: "transparent",
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
	},
	pillText: { flexShrink: 1 },
	more: { position: "absolute", top: 7, right: 6 },
}));
