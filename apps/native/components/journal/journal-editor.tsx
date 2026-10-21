import { EmptyState } from "@/components/empty-state";
import { useDisplayHabit } from "@/components/habit/display-habit";
import {
	CalendarDays,
	Check,
	ChevronDown,
	Ellipsis,
	Info,
	Link2,
	Pin,
	PinOff,
	Plus,
	Signature,
	Trash2,
	UserRound,
} from "@/components/icons";
import { ActionList, type SheetAction } from "@/components/sheet/action-list";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { type AppTranslator, useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type DayKey,
	type Habit,
	type Identity,
	JOURNAL_KIND_SPECS,
	type JournalDraft,
	type JournalEditorStatus,
	type JournalEntry,
	type MessageKey,
	type Weekday,
	addDays,
	capitalize,
	displayKind,
	journalEligibleHabits,
	journalKindKey,
	journalLeadKey,
	journalLinkLabel,
	reviewScopeOf,
} from "@atomic/core";
import {
	useActions,
	useAtomic,
	useHabits,
	useIdentities,
	useJournalEditor,
	useText,
	useToday,
} from "@atomic/core/react";
import { router } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AccessibilityInfo,
	AppState,
	Platform,
	type ScrollView,
	type TextInput,
	View,
} from "react-native";
import { type JournalBlockContext, JournalBlocks, JournalDaySheet } from "./journal-blocks";
import { JournalKindIcon } from "./kind-icon";

/** Back to where the user came from, else the Journal. */
export function closeJournal(): void {
	if (router.canGoBack()) router.back();
	else router.replace("/journal");
}

/**
 * Moves screen-reader focus to `ref` once mounted: steps of the same screen
 * (picker → habit → editor) get no announcement of their own otherwise.
 * Sighted users see no change, and the keyboard never opens by itself.
 */
export function useAccessibilityFocusOnMount(ref: { current: View | null }) {
	useEffect(() => {
		const id = setTimeout(() => {
			const node = ref.current;
			if (!node) return;
			try {
				AccessibilityInfo.sendAccessibilityEvent(node, "focus");
			} catch {
				// Not supported on this platform (the web preview).
			}
		}, 450);
		return () => clearTimeout(id);
	}, [ref]);
}

/** Polite status text, changed at most once every `ms` (Annex J §1.3: one announcement per 2 s). */
function useThrottledText(value: string, ms: number): string {
	const [shown, setShown] = useState("");
	const last = useRef(0);
	useEffect(() => {
		if (!value) return;
		const wait = Math.max(0, last.current + ms - Date.now());
		const timer = setTimeout(() => {
			last.current = Date.now();
			setShown(value);
		}, wait);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return shown;
}

/** "Saving…" / "Saved" in the top bar; screen readers hear it at most every 2 s, queued behind speech. */
function SaveStatus({ status }: { status: JournalEditorStatus }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const label =
		status === "saving" ? t.t("journal.saving") : status === "saved" ? t.t("journal.saved") : "";
	const live = useThrottledText(label, 2000);
	useEffect(() => {
		if (!live) return;
		if (Platform.OS === "ios") {
			AccessibilityInfo.announceForAccessibilityWithOptions(live, { queue: true });
		} else {
			AccessibilityInfo.announceForAccessibility(live);
		}
	}, [live]);
	return (
		<View
			style={[styles.status, status === "idle" && styles.hidden]}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			testID="journal-status"
		>
			{status === "saving" ? (
				<View style={[styles.statusDot, { backgroundColor: colors.textSubtle }]} />
			) : (
				<Check size={14} color={colors.success} strokeWidth={2.5} />
			)}
			<Text variant="small" tone="muted" numberOfLines={1}>
				{label || t.t("journal.saved")}
			</Text>
		</View>
	);
}

/** "About today" / "About yesterday" / "About Oct 17". */
function aboutLabel(day: DayKey, today: DayKey, t: AppTranslator) {
	if (day === today) return t.t("journal.aboutToday");
	if (day === addDays(today, -1)) return t.t("journal.aboutYesterday");
	return t.t("journal.about", { date: t.formatDayShort(day) });
}

/** A link pill that wraps a long identity statement over two lines instead of clipping it. */
function LinkChip({
	leading,
	label,
	muted,
	dashed,
	readOnly,
	disabled,
	onPress,
	accessibilityLabel,
	testID,
}: {
	leading: ReactNode;
	label: string;
	muted?: boolean;
	dashed?: boolean;
	readOnly?: boolean;
	disabled?: boolean;
	onPress?: () => void;
	accessibilityLabel: string;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const pressable = !readOnly && !disabled && !!onPress;
	return (
		<PressableScale
			testID={testID}
			disabled={!pressable}
			scaleTo={0.96}
			hitSlop={4}
			onPress={() => {
				haptics.selection();
				onPress?.();
			}}
			accessibilityRole={readOnly ? "text" : "button"}
			accessibilityLabel={accessibilityLabel}
			accessibilityState={readOnly ? undefined : { disabled: !pressable }}
			style={[
				styles.chip,
				readOnly && styles.chipReadOnly,
				dashed && styles.chipDashed,
				disabled && { opacity: 0.6 },
			]}
		>
			{leading}
			<Text
				variant="small"
				weight="medium"
				tone={muted ? "muted" : "default"}
				numberOfLines={2}
				style={styles.chipText}
			>
				{label}
			</Text>
			{readOnly ? null : <ChevronDown size={15} color={colors.textSubtle} strokeWidth={2} />}
		</PressableScale>
	);
}

/** A row of a picking sheet: radio semantics, a check on the chosen one. */
export function PickRow({
	leading,
	label,
	selected,
	onPress,
	testID,
}: {
	leading: ReactNode;
	label: string;
	selected: boolean;
	onPress(): void;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<PressableScale
			testID={testID}
			scaleTo={0.98}
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			accessibilityRole="radio"
			accessibilityState={{ selected }}
			accessibilityLabel={label}
			style={[styles.pickRow, selected && { backgroundColor: colors.sunken }]}
		>
			<View style={styles.pickLeading}>{leading}</View>
			<Text weight={selected ? "semibold" : "medium"} style={styles.grow}>
				{label}
			</Text>
			{selected ? <Check size={18} color={colors.accentText} strokeWidth={2.5} /> : null}
		</PressableScale>
	);
}

function Emoji({ children }: { children: string }) {
	const styles = useStyles();
	return (
		<Text style={styles.emoji} allowFontScaling={false}>
			{children}
		</Text>
	);
}

interface LinkRowProps {
	ctx: JournalBlockContext;
	identity: Identity | undefined;
	/** New entries of a kind that needs a habit: switch habit (restarts the draft with its prefills). */
	onChangeHabit?(habitId: string): void;
}

/**
 * The entry's links (Annex J §1.2, §5): the day it is about (never after
 * today), the identity (unless the kind hides it) and the habit. The habit
 * of a comeback plan, check-in or contract can't change once the entry
 * exists; before that, another habit restarts the draft.
 */
function LinkRow({ ctx, identity, onChangeHabit }: LinkRowProps) {
	const t = useT();
	const text = useText();
	const today = useToday();
	const { colors } = useTheme();
	const styles = useStyles();
	const identities = useIdentities();
	const habits = useHabits();
	const habitRecords = useAtomic((s) => s.data.habits);
	const identityRecords = useAtomic((s) => s.data.identities);
	const [sheet, setSheet] = useState<"date" | "identity" | "habit" | null>(null);
	const { editor, kind, habit, locked } = ctx;
	const { draft } = editor;
	const spec = JOURNAL_KIND_SPECS[kind];
	const showDate = kind !== "review" && kind !== "contract";
	const identityLink = journalLinkLabel("identity", draft.identityId, identityRecords, t);
	const habitLink = journalLinkLabel("habit", draft.habitId, habitRecords, t);
	const identityMissing = spec.identity === "required" && editor.check.missing.includes("identity");
	const close = () => setSheet(null);

	const pickIdentity = (id: string | null) => {
		const next = id ? identities.find((i) => i.id === id) : undefined;
		const patch: Partial<JournalDraft> = { identityId: id };
		// A belief's new story follows the identity while it still reads as the old one's statement.
		if (kind === "belief") {
			const story = draft.answers.newStory ?? "";
			const previous = identity && !identity.deletedAt ? identity.statement : "";
			if (!story.trim() || story === previous) {
				patch.answers = { ...draft.answers, newStory: next?.statement ?? "" };
			}
		}
		editor.update(patch);
		close();
	};

	const pickHabit = (id: string | null) => {
		close();
		if (habitRequired) {
			if (id && id !== draft.habitId) onChangeHabit?.(id);
			return;
		}
		const next = id ? habits.find((h) => h.id === id) : undefined;
		const patch: Partial<JournalDraft> = { habitId: id };
		// Evidence for a habit is evidence for its identity, unless one is chosen already.
		if (next && !draft.identityId && spec.identity !== "hidden" && next.identityId) {
			if (identities.some((i) => i.id === next.identityId)) patch.identityId = next.identityId;
		}
		editor.update(patch);
	};

	const habitRequired = spec.habit === "build" || spec.habit === "break" || spec.habit === "any";
	const habitChangeable = habitRequired ? !editor.entryId && !!onChangeHabit : !locked;
	const habitOptions = habitRequired ? journalEligibleHabits(kind, habits) : habits;
	const habitShown = habit && !habitLink?.deleted;
	const habitLabel = habitShown
		? text.habit(habit, "name")
		: (habitLink?.text ?? t.t("journal.noHabit"));
	const identityShown = identity && !identityLink?.deleted;
	const identityLabel = identityShown
		? text.identity(identity, "statement")
		: (identityLink?.text ??
			t.t(spec.identity === "required" ? "journal.pickIdentity" : "journal.noIdentity"));
	const iconColor = colors.textMuted;

	return (
		<View style={styles.links}>
			{showDate ? (
				<LinkChip
					testID="journal-link-date"
					leading={<CalendarDays size={15} color={iconColor} strokeWidth={2} />}
					label={aboutLabel(draft.date, today, t)}
					disabled={locked}
					onPress={() => setSheet("date")}
					accessibilityLabel={`${t.t("journal.dateLabel")}: ${t.formatDayLong(draft.date)}`}
				/>
			) : null}

			{spec.identity !== "hidden" ? (
				<View style={styles.linkWithTag}>
					<LinkChip
						testID="journal-link-identity"
						leading={
							identityShown ? (
								<Emoji>{identity.emoji}</Emoji>
							) : (
								<UserRound size={15} color={iconColor} strokeWidth={2} />
							)
						}
						label={identityLabel}
						muted={!identityShown}
						dashed={identityMissing}
						disabled={locked}
						onPress={() => setSheet("identity")}
						accessibilityLabel={`${t.t("journal.link.identity")}: ${identityLabel}${
							identityMissing ? `. ${t.t("journal.required")}` : ""
						}`}
					/>
					{identityMissing ? (
						<View
							style={styles.requiredTag}
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
						>
							<Text variant="tiny" weight="semibold" tone="muted">
								{t.t("journal.required")}
							</Text>
						</View>
					) : null}
				</View>
			) : null}

			{spec.habit !== "hidden" ? (
				<LinkChip
					testID="journal-link-habit"
					leading={
						habitShown ? (
							<Emoji>{habit.emoji}</Emoji>
						) : (
							<Link2 size={15} color={iconColor} strokeWidth={2} />
						)
					}
					label={habitLabel}
					muted={!habitShown}
					readOnly={!habitChangeable}
					onPress={() => setSheet("habit")}
					accessibilityLabel={`${t.t("journal.link.habit")}: ${habitLabel}`}
				/>
			) : null}

			{showDate ? (
				<JournalDaySheet
					open={sheet === "date"}
					title={t.t("journal.dateLabel")}
					value={draft.date}
					max={today}
					onClose={close}
					onPick={(date) => {
						editor.update({ date });
						close();
					}}
				/>
			) : null}

			<Sheet
				open={sheet === "identity"}
				onClose={close}
				title={t.t("journal.link.identity")}
				scroll
				testID="journal-identity-sheet"
			>
				<View accessibilityRole="radiogroup" style={styles.pickList}>
					{spec.identity === "optional" ? (
						<PickRow
							leading={<UserRound size={18} color={iconColor} strokeWidth={2} />}
							label={t.t("journal.noIdentity")}
							selected={!draft.identityId}
							onPress={() => pickIdentity(null)}
						/>
					) : null}
					{identities.map((item) => (
						<PickRow
							key={item.id}
							testID={`journal-identity-${item.id}`}
							leading={<Emoji>{item.emoji}</Emoji>}
							label={text.identity(item, "statement")}
							selected={draft.identityId === item.id}
							onPress={() => pickIdentity(item.id)}
						/>
					))}
				</View>
				{identities.length ? null : (
					<Button
						label={t.t("journal.addIdentity")}
						icon={Plus}
						variant="secondary"
						onPress={() => {
							close();
							router.push("/identity");
						}}
						style={styles.sheetButton}
					/>
				)}
			</Sheet>

			{habitChangeable ? (
				<Sheet
					open={sheet === "habit"}
					onClose={close}
					title={t.t(habitRequired ? "journal.changeHabit" : "journal.link.habit")}
					scroll
					testID="journal-habit-sheet"
				>
					<View accessibilityRole="radiogroup" style={styles.pickList}>
						{habitRequired ? null : (
							<PickRow
								leading={<Link2 size={18} color={iconColor} strokeWidth={2} />}
								label={t.t("journal.noHabit")}
								selected={!draft.habitId}
								onPress={() => pickHabit(null)}
							/>
						)}
						{habitOptions.map((item: Habit) => (
							<PickRow
								key={item.id}
								testID={`journal-habit-option-${item.id}`}
								leading={<Emoji>{item.emoji}</Emoji>}
								label={text.habit(item, "name")}
								selected={draft.habitId === item.id}
								onPress={() => pickHabit(item.id)}
							/>
						))}
					</View>
				</Sheet>
			) : null}
		</View>
	);
}

interface JournalEditorProps {
	/** Edit this stored entry. */
	entryId?: string;
	/** A new entry's draft (`newJournalDraft`); nothing is written until the first change. */
	initial?: JournalDraft;
	/** New entries of a kind that needs a habit: switch habit before writing. */
	onChangeHabit?(habitId: string): void;
}

/**
 * The journal editor (Annex J §1.3, §5). It autosaves: opening writes
 * nothing, the first change creates the entry, later changes are saved
 * after a pause ("Saving…" / "Saved"), going to the background saves what's
 * pending, and Done, Back (also the hardware button and the swipe) flush
 * and drop an entry left empty. Required prompts never block saving; they
 * are marked "Required". The ⋯ sheet pins, revokes a contract's signature
 * or deletes (with Undo).
 */
export function JournalEditor({ entryId, initial, onChangeHabit }: JournalEditorProps) {
	const t = useT();
	const actions = useActions();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const editor = useJournalEditor({ entryId, initial });
	const { draft } = editor;
	const kind = displayKind(draft.kind);
	const habit = useAtomic((s) => (draft.habitId ? s.data.habits[draft.habitId] : undefined));
	const shown = useDisplayHabit(habit);
	const identity = useAtomic((s) =>
		draft.identityId ? s.data.identities[draft.identityId] : undefined,
	);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	const locked = kind === "contract" && draft.contract?.signedAt != null;
	const [menu, setMenu] = useState(false);
	const scrollRef = useRef<ScrollView>(null);
	const headingRef = useRef<View>(null);
	const fields = useRef(new Map<string, TextInput>());
	useAccessibilityFocusOnMount(headingRef);

	const registerField = useCallback((id: string, input: TextInput | null) => {
		if (input) fields.current.set(id, input);
		else fields.current.delete(id);
	}, []);
	const focusField = useCallback(
		(id: string) => {
			const input = fields.current.get(id);
			if (!input) return;
			// Scroll first, then focus once the scroll has settled: a scroll still running
			// would dismiss the keyboard (and blur the field) on the web preview.
			const focus = (delay: number) => setTimeout(() => input.focus(), delay);
			try {
				const scroll = scrollRef.current as
					| (ScrollView & { getInnerViewRef?: () => unknown })
					| null;
				const inner = scroll?.getInnerViewRef?.();
				if (!scroll || !inner) {
					focus(60);
					return;
				}
				input.measureLayout(
					inner as never,
					(_x, y) => {
						scroll.scrollTo({ y: Math.max(0, y - 140), animated: !reduceMotion });
						focus(reduceMotion ? 150 : 550);
					},
					() => focus(60),
				);
			} catch {
				focus(60);
			}
		},
		[reduceMotion],
	);

	const ctx = useMemo<JournalBlockContext>(
		() => ({
			editor,
			kind,
			habit,
			shown,
			locked,
			entryId: editor.entryId,
			registerField,
			focusField,
		}),
		[editor, kind, habit, shown, locked, registerField, focusField],
	);

	const { finish, flush } = editor;

	// Save what's pending when the app goes to the background (Annex J §1.3).
	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") flush();
		});
		return () => sub.remove();
	}, [flush]);

	const isNew = !!initial && !entryId;
	const done = () => {
		const kept = finish();
		// Proof written down: the same success tap as a completed habit.
		if (kept && isNew && kept.kind === "evidence") haptics.success();
		else haptics.light();
		closeJournal();
	};

	const remove = () => {
		const id = editor.entryId;
		setMenu(false);
		if (!id) return;
		flush();
		actions.deleteJournalEntry(id);
		haptics.warning();
		showToast(t.t("journal.deleted"), {
			action: { label: t.t("common.undo"), onPress: () => actions.restoreJournalEntry(id) },
		});
		closeJournal();
	};

	const menuActions: SheetAction[] = [
		{
			key: "pin",
			label: draft.pinned ? t.t("journal.unpin") : t.t("journal.pin"),
			icon: draft.pinned ? PinOff : Pin,
			onPress: () => {
				setMenu(false);
				haptics.selection();
				editor.update({ pinned: !draft.pinned });
			},
		},
	];
	if (locked && editor.entryId) {
		const id = editor.entryId;
		menuActions.push({
			key: "revoke",
			label: t.t("journal.contract.revoke"),
			icon: Signature,
			onPress: () => {
				setMenu(false);
				haptics.light();
				actions.revokeContractSignature(id);
			},
		});
	}
	if (editor.entryId) {
		menuActions.push({
			key: "delete",
			label: t.t("journal.delete"),
			icon: Trash2,
			tone: "danger",
			onPress: remove,
		});
	}

	// A review links nothing: no date chip (it is about its period), no identity, no habit.
	const hasLinks = kind !== "review";
	const scope = kind === "review" && draft.range ? reviewScopeOf(draft.range, weekStartsOn) : null;
	const title = scope
		? t.t(`journal.review.scope.${scope}` as MessageKey)
		: t.t(journalKindKey(kind));
	const accent =
		kind === "evidence" && identity && !identity.deletedAt ? identity.color : undefined;

	return (
		<Screen
			back
			onBack={done}
			title={title}
			keyboard
			scrollRef={scrollRef}
			right={
				<View style={styles.barRight}>
					<SaveStatus status={editor.status} />
					<IconButton
						icon={Ellipsis}
						variant="soft"
						size={38}
						accessibilityLabel={t.t("common.more")}
						onPress={() => setMenu(true)}
						testID="journal-menu"
					/>
					<Button
						label={t.t("common.done")}
						variant="ink"
						size="sm"
						onPress={done}
						testID="journal-done-top"
					/>
				</View>
			}
			testID="journal-editor"
		>
			<View ref={headingRef} accessible accessibilityRole="header" style={styles.heading}>
				<JournalKindIcon kind={kind} color={accent} />
				<Text variant="h2" style={styles.grow}>
					{title}
				</Text>
			</View>
			{hasLinks ? <LinkRow ctx={ctx} identity={identity} onChangeHabit={onChangeHabit} /> : null}
			<Text italic variant="display" tone="muted" style={styles.lead}>
				{t.t(journalLeadKey(kind, habit))}
			</Text>
			<JournalBlocks ctx={ctx} />
			<View style={styles.footer}>
				<Button
					label={t.t("common.done")}
					icon={Check}
					size="lg"
					fullWidth
					onPress={done}
					testID="journal-done"
				/>
			</View>
			<Sheet open={menu} onClose={() => setMenu(false)} title={title} testID="journal-menu-sheet">
				<ActionList actions={menuActions} />
			</Sheet>
		</Screen>
	);
}

/**
 * An entry of a kind this build doesn't know (written by a newer Atomic):
 * shown as a note with every answer in stored order, read-only (Annex J §1.1).
 */
export function JournalReadOnly({ entry }: { entry: JournalEntry }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const headingRef = useRef<View>(null);
	useAccessibilityFocusOnMount(headingRef);
	const title = t.t(journalKindKey(entry.kind));
	const answers = Object.values(entry.answers ?? {}).filter((value) => value.trim());
	return (
		<Screen back onBack={closeJournal} title={title} testID="journal-read-only">
			<View ref={headingRef} accessible accessibilityRole="header" style={styles.heading}>
				<JournalKindIcon kind="note" />
				<Text variant="h2" style={styles.grow}>
					{title}
				</Text>
			</View>
			<View style={styles.notice}>
				<Info size={16} color={colors.textMuted} strokeWidth={2} />
				<Text variant="small" tone="muted" style={styles.grow}>
					{t.t("journal.newerVersion")}
				</Text>
			</View>
			<Text variant="small" tone="muted" style={styles.readDate}>
				{capitalize(t.formatDayLong(entry.date))}
			</Text>
			{answers.map((value, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: answers are static and read-only here.
				<Text key={index} selectable style={styles.readAnswer}>
					{value}
				</Text>
			))}
		</Screen>
	);
}

/** A missing or deleted entry. */
export function JournalEntryNotFound() {
	const t = useT();
	return (
		<Screen back onBack={closeJournal} title={t.t("nav.journal")} testID="journal-not-found">
			<EmptyState
				title={t.t("notFound.title")}
				body={t.t("notFound.body")}
				action={
					<Button label={t.t("nav.journal")} size="lg" onPress={() => router.replace("/journal")} />
				}
			/>
		</Screen>
	);
}

const useStyles = makeStyles((t) => ({
	grow: { flex: 1, flexShrink: 1 },
	hidden: { opacity: 0 },
	barRight: { flexDirection: "row", alignItems: "center", gap: 10 },
	status: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 110 },
	statusDot: { width: 6, height: 6, borderRadius: 3 },
	heading: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
	links: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 22 },
	linkWithTag: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
	chip: {
		flexDirection: "row",
		alignItems: "center",
		gap: 7,
		minHeight: 38,
		maxWidth: "100%",
		paddingVertical: 6,
		paddingLeft: 12,
		paddingRight: 10,
		borderRadius: 19,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	chipReadOnly: { backgroundColor: t.colors.sunken, paddingRight: 14 },
	chipDashed: { borderStyle: "dashed", borderColor: t.colors.borderStrong },
	chipText: { flexShrink: 1 },
	requiredTag: {
		height: 24,
		paddingHorizontal: 10,
		borderRadius: 999,
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	emoji: { fontSize: 15, lineHeight: 20 },
	lead: { fontSize: 22, lineHeight: 30, marginBottom: 28 },
	footer: {
		marginTop: 36,
		paddingTop: 20,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	pickList: { marginHorizontal: -8, gap: 2 },
	pickRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		minHeight: 52,
		paddingVertical: 8,
		paddingHorizontal: 8,
		borderRadius: t.radii.md,
	},
	pickLeading: { width: 28, alignItems: "center" },
	sheetButton: { marginTop: 12 },
	notice: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		padding: 14,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.sunken,
		marginBottom: 16,
	},
	readDate: { marginBottom: 12 },
	readAnswer: { marginBottom: 16 },
}));
