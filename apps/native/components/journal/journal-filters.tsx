import {
	ChevronDown,
	Link2,
	type LucideIcon,
	NotebookText,
	Search,
	UserRound,
	X,
} from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Chip } from "@/components/ui/chip";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { fonts, makeStyles, useTheme } from "@/lib/theme";
import {
	JOURNAL_KINDS,
	JOURNAL_KIND_SPECS,
	type JournalKind,
	type JournalTimelineKind,
	journalKindKey,
	journalLinkLabel,
} from "@atomic/core";
import { useAllHabits, useAtomic, useIdentities, useText } from "@atomic/core/react";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, ScrollView, TextInput, View } from "react-native";
import { PickRow } from "./journal-editor";
import { JOURNAL_KIND_ICONS } from "./kind-icon";

/** The Journal's filters (Annex J §5): route params seed them, the screen keeps them. */
export interface JournalFilterState {
	/** An identity id, or "none". */
	identity?: string;
	habit?: string;
	/** Selected kinds and "dayNote"; empty: everything. */
	kinds: readonly JournalTimelineKind[];
	q?: string;
}

export type JournalFilterPatch = Partial<Omit<JournalFilterState, "kinds">> & {
	kinds?: readonly JournalTimelineKind[];
};

/** Chip order: the picker's (Quick, Plan, Reflect, Free), then day notes. */
export const KIND_CHIPS: readonly JournalTimelineKind[] = [
	...(["quick", "plan", "reflect", "free"] as const).flatMap((group) =>
		JOURNAL_KINDS.filter((kind) => JOURNAL_KIND_SPECS[kind].group === group),
	),
	"dayNote",
];

export function hasActiveFilters(state: JournalFilterState): boolean {
	return !!(state.identity || state.habit || state.kinds.length || state.q);
}

/** How long typing waits before the search applies (Annex J §4–§5). */
const SEARCH_DEBOUNCE_MS = 150;

interface JournalFiltersProps {
	value: JournalFilterState;
	onChange(patch: JournalFilterPatch): void;
	/** Shown (and announced) while any filter is on. */
	resultCount: number;
	onClear(): void;
	searchRef?: Ref<TextInput>;
}

/**
 * The Journal's toolbar (Annex J §5): the search box (debounced), then one
 * sideways-scrolling row — the identity and habit pickers (bottom sheets)
 * first, then the kind chips and "Day notes" (multi-select). While any
 * filter is on, "N entries · Clear filters", with the count announced.
 */
export function JournalFilters({
	value,
	onChange,
	resultCount,
	onClear,
	searchRef,
}: JournalFiltersProps) {
	const t = useT();
	const styles = useStyles();
	const active = hasActiveFilters(value);
	const selected = new Set(value.kinds);
	const [sheet, setSheet] = useState<"identity" | "habit" | null>(null);
	const rowRef = useRef<ScrollView>(null);
	const chipX = useRef(new Map<JournalTimelineKind, number>());
	const revealed = useRef(false);
	// Opened already filtered by kind (a link): bring the first chosen chip into view, once.
	const reveal = () => {
		if (revealed.current) return;
		const first = KIND_CHIPS.find((kind) => selected.has(kind));
		if (!first) {
			revealed.current = true;
			return;
		}
		const x = chipX.current.get(first);
		if (x === undefined) return;
		revealed.current = true;
		rowRef.current?.scrollTo({ x: Math.max(0, x - 20), animated: false });
	};
	const results = t.tp("journal.results", resultCount);
	useAnnounce(active ? results : "");

	const toggleKind = (kind: JournalTimelineKind) => {
		haptics.selection();
		const next = selected.has(kind)
			? value.kinds.filter((item) => item !== kind)
			: KIND_CHIPS.filter((item) => item === kind || selected.has(item));
		onChange({ kinds: next });
	};

	return (
		<View style={styles.wrap}>
			<SearchField
				inputRef={searchRef}
				value={value.q ?? ""}
				onChange={(q) => onChange({ q: q || undefined })}
			/>
			<ScrollView
				ref={rowRef}
				horizontal
				showsHorizontalScrollIndicator={false}
				keyboardShouldPersistTaps="handled"
				style={styles.scroller}
				contentContainerStyle={styles.chips}
				accessibilityLabel={t.t("journal.filter.kinds")}
				testID="journal-filter-row"
			>
				<IdentityPill value={value.identity} onPress={() => setSheet("identity")} />
				<HabitPill value={value.habit} onPress={() => setSheet("habit")} />
				<View style={styles.divider} />
				{KIND_CHIPS.map((kind) => {
					const Icon: LucideIcon =
						kind === "dayNote"
							? NotebookText
							: JOURNAL_KIND_ICONS[JOURNAL_KIND_SPECS[kind as JournalKind].icon];
					return (
						<View
							key={kind}
							onLayout={(event) => {
								chipX.current.set(kind, event.nativeEvent.layout.x);
								reveal();
							}}
						>
							<Chip
								icon={Icon}
								selected={selected.has(kind)}
								label={
									kind === "dayNote" ? t.t("journal.filter.dayNotes") : t.t(journalKindKey(kind))
								}
								onPress={() => toggleKind(kind)}
								testID={`journal-chip-${kind}`}
							/>
						</View>
					);
				})}
			</ScrollView>
			{active ? (
				<View style={styles.results}>
					<Text
						variant="small"
						tone="muted"
						tabular
						accessibilityLiveRegion="polite"
						testID="journal-results"
					>
						{results}
					</Text>
					<Text variant="small" tone="subtle" importantForAccessibility="no">
						·
					</Text>
					<PressableScale
						onPress={onClear}
						hitSlop={12}
						accessibilityRole="button"
						testID="journal-clear-filters"
					>
						<Text variant="small" weight="semibold" tone="accent">
							{t.t("journal.filter.clear")}
						</Text>
					</PressableScale>
				</View>
			) : null}

			<IdentitySheet
				open={sheet === "identity"}
				value={value.identity}
				onClose={() => setSheet(null)}
				onChange={(identity) => {
					setSheet(null);
					onChange({ identity });
				}}
			/>
			<HabitSheet
				open={sheet === "habit"}
				value={value.habit}
				onClose={() => setSheet(null)}
				onChange={(habit) => {
					setSheet(null);
					onChange({ habit });
				}}
			/>
		</View>
	);
}

/** Speaks a changed message once things settle (the result count while filtering). */
function useAnnounce(message: string) {
	const last = useRef("");
	useEffect(() => {
		if (!message || message === last.current) return;
		const timer = setTimeout(() => {
			last.current = message;
			if (Platform.OS === "ios") {
				AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
			} else if (Platform.OS !== "android") {
				// Android reads the polite live region on the text itself.
				AccessibilityInfo.announceForAccessibility(message);
			}
		}, 600);
		return () => clearTimeout(timer);
	}, [message]);
	useEffect(() => {
		if (!message) last.current = "";
	}, [message]);
}

/** The search box: local while typing, applied after a short pause; × clears it. */
function SearchField({
	value,
	onChange,
	inputRef,
}: {
	value: string;
	onChange(value: string): void;
	inputRef?: Ref<TextInput>;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [draft, setDraft] = useState(value);
	const [focused, setFocused] = useState(false);
	const sent = useRef(value);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	// Cleared elsewhere ("Clear filters"): follow it.
	useEffect(() => {
		if (value !== sent.current) {
			sent.current = value;
			setDraft(value);
		}
	}, [value]);

	useEffect(() => {
		const next = draft.trim();
		if (next === sent.current.trim()) return;
		const timer = setTimeout(() => {
			sent.current = next;
			onChangeRef.current(next);
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [draft]);

	const clear = () => {
		setDraft("");
		sent.current = "";
		onChangeRef.current("");
	};

	return (
		<View
			style={[styles.search, { borderColor: focused ? colors.accent : "transparent" }]}
			testID="journal-search"
		>
			<Search size={18} color={colors.textSubtle} strokeWidth={2} />
			<TextInput
				ref={inputRef}
				value={draft}
				onChangeText={setDraft}
				placeholder={t.t("journal.search")}
				placeholderTextColor={colors.textSubtle}
				selectionColor={colors.accent}
				cursorColor={colors.accent}
				accessibilityLabel={t.t("journal.search")}
				returnKeyType="search"
				autoCorrect={false}
				maxLength={120}
				maxFontSizeMultiplier={1.6}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onSubmitEditing={() => {
					sent.current = draft.trim();
					onChangeRef.current(draft.trim());
				}}
				style={styles.searchInput}
				testID="journal-search-input"
			/>
			{draft ? (
				<IconButton
					icon={X}
					size={32}
					iconSize={16}
					color={colors.textMuted}
					accessibilityLabel={t.t("journal.clearSearch")}
					onPress={clear}
					testID="journal-search-clear"
				/>
			) : null}
		</View>
	);
}

/** A filter picker's pill: ink while it filters, a chevron for the sheet it opens. */
function FilterPill({
	label,
	value,
	leading,
	active,
	onPress,
	testID,
}: {
	label: string;
	value: string;
	leading: ReactNode;
	active: boolean;
	onPress(): void;
	testID: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const fg = active ? colors.bg : colors.text;
	return (
		<PressableScale
			scaleTo={0.95}
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			accessibilityRole="button"
			accessibilityLabel={`${label}: ${value}`}
			hitSlop={4}
			style={[
				styles.pill,
				active
					? { backgroundColor: colors.text, borderColor: colors.text }
					: { backgroundColor: colors.surface, borderColor: colors.border },
			]}
			testID={testID}
		>
			{leading}
			<Text variant="small" weight="medium" color={fg} numberOfLines={1} style={styles.pillText}>
				{value}
			</Text>
			<ChevronDown size={15} color={active ? colors.bg : colors.textSubtle} strokeWidth={2} />
		</PressableScale>
	);
}

function Emoji({ children }: { children: string }) {
	return (
		<Text style={{ fontSize: 14, lineHeight: 19 }} allowFontScaling={false}>
			{children}
		</Text>
	);
}

function useIdentityLabel(value: string | undefined) {
	const t = useT();
	const text = useText();
	const records = useAtomic((s) => s.data.identities);
	const current = value && value !== "none" ? records[value] : undefined;
	const live = current && !current.deletedAt ? current : undefined;
	const link = value && value !== "none" ? journalLinkLabel("identity", value, records, t) : null;
	const label =
		value === "none"
			? t.t("journal.filter.noIdentity")
			: live
				? text.identity(live, "statement")
				: (link?.text ?? t.t("journal.filter.allIdentities"));
	return { live, label };
}

function useHabitLabel(value: string | undefined) {
	const t = useT();
	const text = useText();
	const records = useAtomic((s) => s.data.habits);
	const current = value ? records[value] : undefined;
	const live = current && !current.deletedAt ? current : undefined;
	const link = value ? journalLinkLabel("habit", value, records, t) : null;
	const label = live ? text.habit(live, "name") : (link?.text ?? t.t("journal.filter.allHabits"));
	return { live, label };
}

function IdentityPill({ value, onPress }: { value: string | undefined; onPress(): void }) {
	const t = useT();
	const { colors } = useTheme();
	const { live, label } = useIdentityLabel(value);
	return (
		<FilterPill
			label={t.t("journal.link.identity")}
			value={label}
			active={!!value}
			onPress={onPress}
			testID="journal-filter-identity"
			leading={
				live ? (
					<Emoji>{live.emoji}</Emoji>
				) : (
					<UserRound size={16} color={value ? colors.bg : colors.textMuted} strokeWidth={2} />
				)
			}
		/>
	);
}

function HabitPill({ value, onPress }: { value: string | undefined; onPress(): void }) {
	const t = useT();
	const { colors } = useTheme();
	const { live, label } = useHabitLabel(value);
	return (
		<FilterPill
			label={t.t("journal.link.habit")}
			value={label}
			active={!!value}
			onPress={onPress}
			testID="journal-filter-habit"
			leading={
				live ? (
					<Emoji>{live.emoji}</Emoji>
				) : (
					<Link2 size={16} color={value ? colors.bg : colors.textMuted} strokeWidth={2} />
				)
			}
		/>
	);
}

/** Identity filter: All, each live identity, a deleted one still filtered on, No identity. */
function IdentitySheet({
	open,
	value,
	onClose,
	onChange,
}: {
	open: boolean;
	value: string | undefined;
	onClose(): void;
	onChange(value: string | undefined): void;
}) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const identities = useIdentities();
	const { live, label } = useIdentityLabel(value);
	const icon = (Icon: LucideIcon) => <Icon size={18} color={colors.textMuted} strokeWidth={2} />;
	return (
		<Sheet
			open={open}
			onClose={onClose}
			title={t.t("journal.link.identity")}
			scroll
			testID="journal-identity-filter-sheet"
		>
			<View accessibilityRole="radiogroup" style={styles.pickList}>
				<PickRow
					leading={icon(UserRound)}
					label={t.t("journal.filter.allIdentities")}
					selected={!value}
					onPress={() => onChange(undefined)}
				/>
				{identities.map((identity) => (
					<PickRow
						key={identity.id}
						leading={<Emoji>{identity.emoji}</Emoji>}
						label={text.identity(identity, "statement")}
						selected={value === identity.id}
						onPress={() => onChange(identity.id)}
						testID={`journal-filter-identity-${identity.id}`}
					/>
				))}
				{value && value !== "none" && !live ? (
					<PickRow leading={null} label={label} selected onPress={() => onChange(value)} />
				) : null}
				<View style={styles.sheetDivider} />
				<PickRow
					leading={null}
					label={t.t("journal.filter.noIdentity")}
					selected={value === "none"}
					onPress={() => onChange("none")}
					testID="journal-filter-identity-none"
				/>
			</View>
		</Sheet>
	);
}

/** Habit filter: All, active habits, then archived ones, and a deleted one still filtered on. */
function HabitSheet({
	open,
	value,
	onClose,
	onChange,
}: {
	open: boolean;
	value: string | undefined;
	onClose(): void;
	onChange(value: string | undefined): void;
}) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const habits = useAllHabits();
	const { live, label } = useHabitLabel(value);
	const current = habits.filter((habit) => !habit.archivedAt);
	const archived = habits.filter((habit) => habit.archivedAt);
	const row = (habit: (typeof habits)[number]) => (
		<PickRow
			key={habit.id}
			leading={<Emoji>{habit.emoji}</Emoji>}
			label={text.habit(habit, "name")}
			selected={value === habit.id}
			onPress={() => onChange(habit.id)}
			testID={`journal-filter-habit-${habit.id}`}
		/>
	);
	return (
		<Sheet
			open={open}
			onClose={onClose}
			title={t.t("journal.link.habit")}
			scroll
			testID="journal-habit-filter-sheet"
		>
			<View accessibilityRole="radiogroup" style={styles.pickList}>
				<PickRow
					leading={<Link2 size={18} color={colors.textMuted} strokeWidth={2} />}
					label={t.t("journal.filter.allHabits")}
					selected={!value}
					onPress={() => onChange(undefined)}
				/>
				{current.map(row)}
				{value && !live ? (
					<PickRow leading={null} label={label} selected onPress={() => onChange(value)} />
				) : null}
			</View>
			{archived.length ? (
				<>
					<Text variant="label" accessibilityRole="header" style={styles.sheetLabel}>
						{t.t("habits.filter.archived")}
					</Text>
					<View accessibilityRole="radiogroup" style={styles.pickList}>
						{archived.map(row)}
					</View>
				</>
			) : null}
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	wrap: { gap: 12 },
	search: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		minHeight: 48,
		paddingLeft: 14,
		paddingRight: 6,
		borderRadius: t.radii.md,
		borderWidth: 1.5,
		backgroundColor: t.colors.sunken,
	},
	searchInput: {
		flex: 1,
		minWidth: 0,
		fontFamily: fonts.regular,
		fontSize: 15,
		color: t.colors.text,
		paddingVertical: 12,
		outlineWidth: 0,
	},
	// Edge to edge: chips scroll under the screen's 20pt gutters.
	scroller: { marginHorizontal: -20 },
	chips: { paddingHorizontal: 20, gap: 8, alignItems: "center", paddingVertical: 2 },
	divider: { width: 1, height: 22, marginHorizontal: 2, backgroundColor: t.colors.border },
	pill: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		height: 36,
		maxWidth: 220,
		paddingHorizontal: 13,
		borderRadius: 999,
		borderWidth: 1,
	},
	pillText: { flexShrink: 1 },
	results: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
	pickList: { marginHorizontal: -8, gap: 2 },
	sheetDivider: {
		height: 1,
		marginVertical: 6,
		marginHorizontal: 8,
		backgroundColor: t.colors.border,
	},
	sheetLabel: { marginTop: 18, marginBottom: 6 },
}));
