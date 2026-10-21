import { ArrowRight, Plus, Vote } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type Identity,
	type IdentityJournalStats,
	type JournalEntry,
	journalPreview,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useIdentities,
	useJournal,
	useText,
	useToday,
} from "@atomic/core/react";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { refocus } from "./day-note-card";
import {
	journalCardLabel,
	journalDayLabel,
	journalEntryTitle,
	openJournalEntry,
} from "./entry-card";
import { JournalItemList } from "./journal-timeline";
import { JournalKindIcon } from "./kind-icon";

/** How many entries the Identity screen's Journal section lists (Annex J §5). */
const RECENT = 3;

/** Opens the full editor on a new evidence entry for an identity. */
export function writeEvidence(identityId: string): void {
	router.push({ pathname: "/journal/editor", params: { kind: "evidence", identityId } });
}

/**
 * The journal strip of an identity card (Annex J §1.5): the evidence count
 * (evidence never adds votes), a link to the identity's journal, the newest
 * entry as one line, and "+ Evidence" (a one-line sheet). Owner: T3.
 */
export function IdentityJournalStrip({
	identity,
	stats,
}: {
	identity: Identity;
	stats: IdentityJournalStats | undefined;
}) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.strip}>
			<View style={styles.stripTop}>
				<View style={styles.count}>
					<Vote size={16} color={colors.textSubtle} strokeWidth={2} />
					<Text variant="small" weight="medium" testID={`identity-evidence-${identity.id}`}>
						{t.tp("journal.evidence.count", stats?.evidence ?? 0)}
					</Text>
				</View>
				<PressableScale
					onPress={() => router.push({ pathname: "/journal", params: { identityId: identity.id } })}
					accessibilityRole="link"
					accessibilityLabel={`${t.t("nav.journal")}: ${text.identity(identity, "statement")}`}
					hitSlop={10}
					style={styles.link}
					testID={`identity-journal-${identity.id}`}
				>
					<Text variant="small" weight="semibold" tone="accent">
						{t.t("nav.journal")}
					</Text>
					<ArrowRight size={14} color={colors.accentText} strokeWidth={2.2} />
				</PressableScale>
			</View>
			{stats?.latest ? <LatestEntry entry={stats.latest} identity={identity} /> : null}
			<QuickEvidence identity={identity} />
		</View>
	);
}

/** The newest entry of an identity, one line: icon, preview and day. */
function LatestEntry({ entry, identity }: { entry: JournalEntry; identity: Identity }) {
	const t = useT();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const title = journalEntryTitle(entry, t, weekStartsOn);
	const date = journalDayLabel(entry.date, today, t);
	const preview = journalPreview(entry, 140);
	return (
		<Pressable
			onPress={() => openJournalEntry(entry.id)}
			accessibilityRole="button"
			accessibilityLabel={journalCardLabel(t, title, date, preview)}
			style={({ pressed }) => [styles.latest, pressed && { backgroundColor: colors.hover }]}
		>
			<JournalKindIcon
				kind={entry.kind}
				color={entry.kind === "evidence" ? identity.color : undefined}
				size="xs"
			/>
			<Text variant="small" numberOfLines={1} style={styles.grow}>
				{preview || title}
			</Text>
			<Text variant="tiny" tone="muted">
				{date}
			</Text>
		</Pressable>
	);
}

/**
 * "+ Evidence" (Annex J §1.5): a one-line sheet. Done saves an evidence
 * entry for today ("Evidence saved. Proof adds up.", with Undo); focus
 * comes back to the button. Evidence never adds votes.
 */
export function QuickEvidence({ identity }: { identity: Identity }) {
	const t = useT();
	const text = useText();
	const actions = useActions();
	const today = useToday();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const ref = useRef<View>(null);
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
	const statement = text.identity(identity, "statement");
	const label = t.t("journal.evidence.quickLabel", { identity: statement });

	const close = () => {
		setOpen(false);
		setValue("");
	};

	const save = () => {
		const answer = value.trim();
		if (!answer) return;
		let entry: JournalEntry;
		try {
			entry = actions.createJournalEntry({
				kind: "evidence",
				identityId: identity.id,
				date: today,
				answers: { text: answer },
			});
		} catch {
			return;
		}
		haptics.success();
		showToast(t.t("journal.evidence.added"), {
			tone: "success",
			action: { label: t.t("common.undo"), onPress: () => actions.deleteJournalEntry(entry.id) },
		});
		close();
	};

	return (
		<>
			<Pressable
				ref={ref}
				onPress={() => {
					haptics.selection();
					setOpen(true);
				}}
				accessibilityRole="button"
				accessibilityLabel={label}
				hitSlop={6}
				style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.hover }]}
				testID={`identity-add-evidence-${identity.id}`}
			>
				<Plus size={14} color={colors.textMuted} strokeWidth={2.2} />
				<Text variant="small" weight="medium" tone="muted">
					{t.t("journal.evidence.add")}
				</Text>
			</Pressable>
			<Sheet
				open={open}
				onClose={close}
				onClosed={() => refocus(ref.current)}
				title={t.t("journal.evidence.add")}
				subtitle={statement}
				leading={
					<View style={[styles.sheetEmoji, { backgroundColor: toneOf(identity.color).soft }]}>
						<Text style={{ fontSize: 22, lineHeight: 28 }} allowFontScaling={false}>
							{identity.emoji}
						</Text>
					</View>
				}
				footer={
					<Button
						label={t.t("common.save")}
						size="lg"
						disabled={!value.trim()}
						onPress={save}
						testID="quick-evidence-save"
					/>
				}
				testID="quick-evidence-sheet"
			>
				<TextField
					value={value}
					onChangeText={setValue}
					placeholder={t.t("journal.evidence.quickPlaceholder")}
					accessibilityLabel={label}
					autoFocus
					maxLength={500}
					returnKeyType="done"
					onSubmitEditing={save}
					testID="quick-evidence-input"
				/>
			</Sheet>
		</>
	);
}

/**
 * The Identity screen's "Journal" section (Annex J §1.5, §5): the newest
 * entries, "See all" and "New entry"; an invitation to write evidence
 * while there are none.
 */
export function IdentityJournalPreview({ style }: { style?: StyleProp<ViewStyle> }) {
	const t = useT();
	const styles = useStyles();
	const journal = useJournal();
	const identities = useIdentities();
	const recent = journal.slice(0, RECENT).map((entry) => ({
		type: "entry" as const,
		key: `entry:${entry.id}`,
		date: entry.date,
		entry,
	}));
	return (
		<View style={style} testID="identity-journal">
			<View style={styles.previewHeader}>
				<Text variant="display" accessibilityRole="header">
					{t.t("journal.title")}
				</Text>
				<Text tone="muted">{t.t("journal.subtitle")}</Text>
			</View>
			{recent.length ? (
				<JournalItemList items={recent} />
			) : (
				<View style={styles.empty}>
					<Text tone="muted">{t.t("journal.emptyBody")}</Text>
					{/* Evidence needs an identity: until there is one, "New entry" below is the way in. */}
					{identities.length ? (
						<Button
							label={t.t("journal.emptyCta")}
							icon={Vote}
							size="sm"
							onPress={() =>
								router.push({ pathname: "/journal/editor", params: { kind: "evidence" } })
							}
							style={styles.start}
						/>
					) : null}
				</View>
			)}
			<View style={styles.previewActions}>
				<Button
					label={t.t("journal.new")}
					icon={Plus}
					variant="secondary"
					size="sm"
					onPress={() => router.push("/journal/editor")}
					testID="identity-journal-new"
				/>
				{journal.length ? (
					<Button
						label={t.t("common.seeAll")}
						iconRight={ArrowRight}
						variant="ghost"
						size="sm"
						onPress={() => router.push("/journal")}
						testID="identity-journal-see-all"
					/>
				) : null}
			</View>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	strip: {
		gap: 10,
		paddingTop: 14,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	stripTop: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "space-between",
		columnGap: 12,
		rowGap: 4,
	},
	count: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
	link: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28 },
	latest: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 44,
		marginHorizontal: -8,
		paddingHorizontal: 8,
		borderRadius: t.radii.md,
	},
	grow: { flex: 1, minWidth: 0 },
	add: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		gap: 5,
		height: 34,
		paddingHorizontal: 13,
		borderRadius: 999,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
	},
	sheetEmoji: {
		width: 44,
		height: 44,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	previewHeader: { gap: 2, marginBottom: 16 },
	previewActions: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		gap: 8,
		marginTop: 14,
	},
	empty: {
		gap: 12,
		padding: 18,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		backgroundColor: t.colors.surface,
	},
	start: { alignSelf: "flex-start" },
}));
